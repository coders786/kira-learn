"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { GeminiSTT, STTResult } from "@/lib/voice/gemini-stt";

// ===== Voice Hook v4 =====
// Replaces browser SpeechRecognition with Gemini-powered transcription
// Like Wispr Flow: accurate, context-aware, noise-resistant
//
// Pipeline: Mic → MediaRecorder → VAD → Gemini STT → text
// Fallback: If Gemini STT fails, falls back to browser SpeechRecognition

type VoiceMode = "push-to-talk" | "always-on";

interface VoiceCallbacks {
  onAutoSend?: (transcript: string) => void;
  onInterimTranscript?: (transcript: string) => void;
}

export function useVoice(callbacks?: VoiceCallbacks) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); // AI speaking via TTS
  const [isUserSpeaking, setIsUserSpeaking] = useState(false); // User speaking into mic
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(false);
  const [mode, setMode] = useState<VoiceMode>("push-to-talk");
  const [sttMode, setSttMode] = useState<"gemini" | "browser">("gemini");

  // Refs
  const sttRef = useRef<GeminiSTT | null>(null);
  const apiKeyRef = useRef<string | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const callbacksRef = useRef<VoiceCallbacks>(callbacks || {});
  const modeRef = useRef<VoiceMode>("push-to-talk");
  const isListeningRef = useRef(false);
  const isStoppingRef = useRef(false);
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranscriptRef = useRef("");

  // Browser SpeechRecognition fallback refs
  const browserRecognitionRef = useRef<any>(null);
  const browserFallbackActive = useRef(false);

  // Keep refs updated
  useEffect(() => {
    callbacksRef.current = callbacks || {};
  }, [callbacks]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // ===== Initialize =====
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hasMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasSynth = !!window.speechSynthesis;
    setSupported(hasMic && hasSynth);

    // Load voices for TTS
    synthRef.current = window.speechSynthesis;
    const loadVoices = () => { synthRef.current?.getVoices(); };
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);

    // Set up browser SpeechRecognition fallback
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let final = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (final) {
          lastTranscriptRef.current = final;
          setTranscript(final);
          // Auto-send after 1.5s silence
          clearAutoSendTimer();
          startAutoSendTimer(final);
        } else if (interim) {
          setTranscript(interim);
        }
      };

      recognition.onend = () => {
        if (modeRef.current === "always-on" && !isStoppingRef.current) {
          try { recognition.start(); } catch {}
        } else {
          isListeningRef.current = false;
          setIsListening(false);
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error !== "aborted" && e.error !== "no-speech") {
          console.warn("[BrowserSTT] Error:", e.error);
        }
      };

      browserRecognitionRef.current = recognition;
    }

    return () => {
      sttRef.current?.stop();
      synthRef.current?.cancel();
      try { browserRecognitionRef.current?.abort(); } catch {}
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  // ===== Auto-send timer =====
  function startAutoSendTimer(text: string) {
    autoSendTimerRef.current = setTimeout(() => {
      if (text.trim()) {
        callbacksRef.current.onAutoSend?.(text.trim());
        lastTranscriptRef.current = "";
        setTranscript("");
      }
    }, 1500);
  }

  function clearAutoSendTimer() {
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
  }

  // ===== Initialize Gemini STT with API key =====
  const initGeminiSTT = useCallback((apiKey: string) => {
    apiKeyRef.current = apiKey;
    if (sttRef.current) {
      sttRef.current.stop();
    }
  }, []);

  // ===== Create/Get Gemini STT instance =====
  function getOrCreateSTT(): GeminiSTT | null {
    if (!apiKeyRef.current) return null;
    if (sttRef.current) return sttRef.current;

    const stt = new GeminiSTT({
      apiKey: apiKeyRef.current,
      maxChunkDuration: 12000,
      silenceDuration: 1500,
    });

    sttRef.current = stt;
    return stt;
  }

  // ===== Start listening =====
  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;
    isStoppingRef.current = false;
    clearAutoSendTimer();
    setTranscript("");
    lastTranscriptRef.current = "";

    // Try Gemini STT first
    const stt = getOrCreateSTT();
    if (stt) {
      try {
        const success = await stt.start(
          // onResult
          (result: STTResult) => {
            if (result.wasSpeech && result.text) {
              setTranscript(result.text);
              lastTranscriptRef.current = result.text;
              // Auto-send immediately after Gemini transcription
              callbacksRef.current.onAutoSend?.(result.text);
              setTranscript("");
              lastTranscriptRef.current = "";
            }
          },
          // onSpeakingChange
          (speaking: boolean) => {
            setIsUserSpeaking(speaking);
            if (speaking) {
              setTranscript("..."); // Show user we hear them
            }
          },
          // onError
          (error: Error) => {
            console.error("[GeminiSTT] Error:", error);
            // Fall back to browser STT
            startBrowserFallback();
          }
        );

        if (success) {
          isListeningRef.current = true;
          setIsListening(true);
          setSttMode("gemini");
          return;
        }
      } catch (e) {
        console.warn("[Voice] Gemini STT failed, falling back to browser:", e);
      }
    }

    // Fall back to browser SpeechRecognition
    startBrowserFallback();
  }, []);

  // ===== Browser STT fallback =====
  function startBrowserFallback() {
    if (!browserRecognitionRef.current) return;

    setSttMode("browser");
    browserFallbackActive.current = true;

    try {
      browserRecognitionRef.current.start();
      isListeningRef.current = true;
      setIsListening(true);
    } catch {
      try {
        browserRecognitionRef.current.stop();
        setTimeout(() => {
          try {
            browserRecognitionRef.current?.start();
            isListeningRef.current = true;
            setIsListening(true);
          } catch {}
        }, 300);
      } catch {}
    }
  }

  // ===== Stop listening =====
  const stopListening = useCallback(async () => {
    isStoppingRef.current = true;
    clearAutoSendTimer();

    // If using Gemini STT
    if (sttRef.current && sttRef.current.active) {
      // Flush any pending audio
      const pending = lastTranscriptRef.current;
      await sttRef.current.flush();
      if (pending) {
        callbacksRef.current.onAutoSend?.(pending);
      }
      sttRef.current.stop();
    }

    // If using browser STT
    if (browserRecognitionRef.current && browserFallbackActive.current) {
      try { browserRecognitionRef.current.stop(); } catch {}
      browserFallbackActive.current = false;
      const pending = lastTranscriptRef.current;
      if (pending) {
        callbacksRef.current.onAutoSend?.(pending);
      }
    }

    isListeningRef.current = false;
    setIsListening(false);
    setIsUserSpeaking(false);
    setTranscript("");
    lastTranscriptRef.current = "";
  }, []);

  // ===== Speak (TTS) =====
  const speak = useCallback((text: string, personality: string = "chill"): Promise<void> => {
    return new Promise((resolve) => {
      if (!synthRef.current) { resolve(); return; }
      synthRef.current.cancel();

      const clean = text
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
        .replace(/[\u{2700}-\u{27BF}]/gu, "")
        .replace(/\*\*/g, "")
        .replace(/`[^`]+`/g, "")
        .replace(/\.{3}/g, ", ")
        .replace(/\?{2,}/g, "?")
        .replace(/!{2,}/g, "!")
        .replace(/\n/g, ". ")
        .replace(/[{}\[\]()]/g, "")
        .replace(/https?:\/\/\S+/g, "")
        .trim();

      if (!clean) { resolve(); return; }

      const utterance = new SpeechSynthesisUtterance(clean);
      const settings: Record<string, { rate: number; pitch: number }> = {
        chill: { rate: 1.0, pitch: 1.0 },
        "drill-sergeant": { rate: 1.1, pitch: 0.85 },
        patient: { rate: 0.85, pitch: 1.05 },
        hype: { rate: 1.15, pitch: 1.15 },
      };
      const s = settings[personality] || settings.chill;
      utterance.rate = s.rate;
      utterance.pitch = s.pitch;
      utterance.volume = 1;

      if (synthRef.current) {
        const voices = synthRef.current.getVoices();
        const priorities = [
          (v: SpeechSynthesisVoice) => v.name.includes("Google US English") && v.localService,
          (v: SpeechSynthesisVoice) => v.name.includes("Google US English"),
          (v: SpeechSynthesisVoice) => v.name.includes("Microsoft Aria"),
          (v: SpeechSynthesisVoice) => v.name.includes("Samantha"),
          (v: SpeechSynthesisVoice) => v.name.includes("Google") && v.lang.startsWith("en"),
          (v: SpeechSynthesisVoice) => v.lang.startsWith("en") && v.localService,
          (v: SpeechSynthesisVoice) => v.lang.startsWith("en"),
        ];
        for (const matcher of priorities) {
          const voice = voices.find(matcher);
          if (voice) { utterance.voice = voice; break; }
        }
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => { setIsSpeaking(false); resolve(); };
      utterance.onerror = () => { setIsSpeaking(false); resolve(); };
      synthRef.current.speak(utterance);
    });
  }, []);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setIsSpeaking(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    lastTranscriptRef.current = "";
    clearAutoSendTimer();
  }, []);

  // ===== Always-on mode =====
  const enableAlwaysOn = useCallback((on: boolean) => {
    setMode(on ? "always-on" : "push-to-talk");
    modeRef.current = on ? "always-on" : "push-to-talk";

    if (on && !isListeningRef.current) {
      startListening();
    } else if (!on && isListeningRef.current) {
      stopListening();
    }
  }, [startListening, stopListening]);

  // ===== Update context for better transcription =====
  const updateContext = useCallback((context: string) => {
    if (sttRef.current) {
      sttRef.current.setContext(context);
    }
  }, []);

  return {
    isListening,
    isSpeaking,
    isUserSpeaking,
    transcript,
    supported,
    mode,
    sttMode, // "gemini" or "browser"
    initGeminiSTT,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    clearTranscript,
    enableAlwaysOn,
    updateContext,
  };
}
