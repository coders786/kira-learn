"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ===== Voice Hook v3 =====
// Completely rebuilt: always-on mic, silence detection, auto-send
// 
// Features:
// - Continuous speech recognition that stays on
// - Silence detection: auto-sends after 2s of no speech
// - Always-on mode: mic never stops, auto-sends each utterance
// - Proper auto-restart with backoff on errors
// - Push-to-talk mode: manual start/stop
// - Auto-speak: reads AI responses aloud

type VoiceMode = "push-to-talk" | "always-on";

interface VoiceCallbacks {
  onAutoSend?: (transcript: string) => void;
  onInterimTranscript?: (transcript: string) => void;
}

export function useVoice(callbacks?: VoiceCallbacks) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [supported, setSupported] = useState(false);
  const [mode, setMode] = useState<VoiceMode>("push-to-talk");

  // Refs for stable references (avoid stale closures)
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const isStoppingRef = useRef(false);
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFinalTranscriptRef = useRef("");
  const isListeningRef = useRef(false);
  const modeRef = useRef<VoiceMode>("push-to-talk");
  const callbacksRef = useRef<VoiceCallbacks>(callbacks || {});
  const errorCountRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callbacks ref updated
  useEffect(() => {
    callbacksRef.current = callbacks || {};
  }, [callbacks]);

  // Keep mode ref updated
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // ===== Initialize SpeechRecognition =====
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    const hasRecognition = !!SpeechRecognition;
    const hasSynth = !!window.speechSynthesis;

    if (hasRecognition && hasSynth) {
      setSupported(true);
      createRecognition(SpeechRecognition);
    }

    // Load voices
    synthRef.current = window.speechSynthesis;
    const loadVoices = () => {
      if (synthRef.current) {
        synthRef.current.getVoices(); // Trigger load
      }
    };
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);

    return () => {
      destroyRecognition();
      synthRef.current?.cancel();
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  function createRecognition(SpeechRecognition: any) {
    destroyRecognition();

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      // Clear silence timer on any speech activity
      clearAutoSendTimer();

      if (finalText) {
        lastFinalTranscriptRef.current = finalText;
        setTranscript(finalText);
        setInterimTranscript("");

        // Start silence timer — auto-send if no more speech in 2 seconds
        startAutoSendTimer(finalText);
      } else if (interimText) {
        setInterimTranscript(interimText);
        setTranscript(interimText);
        callbacksRef.current.onInterimTranscript?.(interimText);
      }
    };

    recognition.onerror = (event: any) => {
      console.log("[Voice] Error:", event.error);

      if (event.error === "aborted") {
        // We caused this — don't auto-restart
        return;
      }

      if (event.error === "no-speech") {
        // No speech detected — this is normal in always-on mode
        // Recognition will auto-continue in continuous mode
        return;
      }

      if (event.error === "network") {
        console.warn("[Voice] Network error — will retry");
        errorCountRef.current++;
      }

      // For other errors, don't set listening false — let onend handle restart
      if (event.error !== "no-speech" && event.error !== "aborted") {
        errorCountRef.current++;
      }
    };

    recognition.onend = () => {
      // Auto-restart in always-on mode (unless we intentionally stopped)
      if (modeRef.current === "always-on" && !isStoppingRef.current) {
        const backoff = Math.min(500 * Math.pow(1.5, errorCountRef.current), 5000);
        restartTimerRef.current = setTimeout(() => {
          try {
            if (recognitionRef.current && !isStoppingRef.current) {
              recognitionRef.current.start();
            }
          } catch {
            // Already running, ignore
          }
        }, backoff);
      } else {
        isListeningRef.current = false;
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    errorCountRef.current = 0;
  }

  function destroyRecognition() {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
  }

  // ===== Auto-send timer =====
  function startAutoSendTimer(text: string) {
    clearAutoSendTimer();
    autoSendTimerRef.current = setTimeout(() => {
      // User stopped talking — auto-send
      if (text.trim()) {
        callbacksRef.current.onAutoSend?.(text.trim());
        lastFinalTranscriptRef.current = "";
        setTranscript("");
        setInterimTranscript("");
      }
    }, 2000); // 2 seconds of silence = auto-send
  }

  function clearAutoSendTimer() {
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
  }

  // ===== Public methods =====

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    isStoppingRef.current = false;
    errorCountRef.current = 0;

    clearAutoSendTimer();
    setTranscript("");
    setInterimTranscript("");
    lastFinalTranscriptRef.current = "";

    try {
      recognitionRef.current.start();
      isListeningRef.current = true;
      setIsListening(true);
    } catch (err: any) {
      // Already running — stop and restart
      try { recognitionRef.current.stop(); } catch {}
      setTimeout(() => {
        try {
          recognitionRef.current?.start();
          isListeningRef.current = true;
          setIsListening(true);
        } catch {}
      }, 300);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    isStoppingRef.current = true;
    clearAutoSendTimer();

    // If there's pending transcript, send it before stopping
    const pending = lastFinalTranscriptRef.current || transcript;
    if (pending.trim()) {
      callbacksRef.current.onAutoSend?.(pending.trim());
    }

    try { recognitionRef.current.stop(); } catch {}
    isListeningRef.current = false;
    setIsListening(false);
    setTranscript("");
    setInterimTranscript("");
    lastFinalTranscriptRef.current = "";
  }, [transcript]);

  const speak = useCallback((text: string, personality: string = "chill"): Promise<void> => {
    return new Promise((resolve) => {
      if (!synthRef.current) { resolve(); return; }

      synthRef.current.cancel();

      // Clean text for TTS
      const clean = text
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
        .replace(/[\u{2700}-\u{27BF}]/gu, "")
        .replace(/\*\*/g, "")
        .replace(/__/g, "")
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

      // Personality-based voice settings
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

      // Find best voice
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
    setInterimTranscript("");
    lastFinalTranscriptRef.current = "";
    clearAutoSendTimer();
  }, []);

  const enableAlwaysOn = useCallback((on: boolean) => {
    setMode(on ? "always-on" : "push-to-talk");
    modeRef.current = on ? "always-on" : "push-to-talk";

    if (on && !isListeningRef.current && recognitionRef.current) {
      // Start listening immediately in always-on mode
      isStoppingRef.current = false;
      try {
        recognitionRef.current.start();
        isListeningRef.current = true;
        setIsListening(true);
      } catch {}
    } else if (!on && isListeningRef.current) {
      stopListening();
    }
  }, [stopListening]);

  return {
    isListening,
    isSpeaking,
    transcript,
    interimTranscript,
    supported,
    mode,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    clearTranscript,
    enableAlwaysOn,
  };
}
