"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ===== Voice Hook v2 =====
// Fixed: continuous recognition, proper voice loading, auto-restart
// Supports "always-on" listening mode

type ListenerMode = "push-to-talk" | "always-on";

export function useVoice() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(false);
  const [mode, setMode] = useState<ListenerMode>("push-to-talk");

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const voicesLoadedRef = useRef(false);
  const isStoppingRef = useRef(false); // Prevent auto-restart when user manually stops

  // Initialize
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check support
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    const hasRecognition = !!SpeechRecognition;
    const hasSynth = !!window.speechSynthesis;

    if (hasRecognition && hasSynth) {
      setSupported(true);

      // Create recognition instance
      const recognition = new SpeechRecognition();
      recognition.continuous = true;        // DON'T STOP after one sentence
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        // Show interim while typing, final when done
        if (finalTranscript) {
          setTranscript(finalTranscript);
        } else if (interimTranscript) {
          setTranscript(interimTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.log("Speech error:", event.error);
        // Don't set listening to false for "aborted" — that's us stopping it
        if (event.error !== "aborted") {
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        // Auto-restart in always-on mode (unless we intentionally stopped)
        if (mode === "always-on" && !isStoppingRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch {
            // Already running, that's fine
          }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    }

    // Load voices
    synthRef.current = window.speechSynthesis;

    const loadVoices = () => {
      if (synthRef.current) {
        const voices = synthRef.current.getVoices();
        if (voices.length > 0) {
          voicesLoadedRef.current = true;
        }
      }
    };

    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
    };
  }, [mode]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    isStoppingRef.current = false;

    setTranscript("");
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err: any) {
      // Already running — stop and restart
      try {
        recognitionRef.current.stop();
      } catch {}
      setTimeout(() => {
        try {
          recognitionRef.current?.start();
          setIsListening(true);
        } catch {}
      }, 200);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    isStoppingRef.current = true;
    try {
      recognitionRef.current.stop();
    } catch {}
    setIsListening(false);
  }, []);

  const speak = useCallback(
    (text: string, personality: string = "chill"): Promise<void> => {
      return new Promise((resolve) => {
        if (!synthRef.current) {
          resolve();
          return;
        }

        // Cancel current speech
        synthRef.current.cancel();

        // Clean text for TTS
        const clean = text
          .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
          .replace(/[\u{2700}-\u{27BF}]/gu, "") // Dingbats (✦ etc)
          .replace(/\.\.\./g, ", ")
          .replace(/\?{2,}/g, "?")
          .replace(/!{2,}/g, "!")
          .replace(/\n/g, ". ")
          .replace(/[{(\[})\]]/g, "")
          .trim();

        if (!clean) {
          resolve();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(clean);

        // Personality-based voice settings
        const settings: Record<string, { rate: number; pitch: number }> = {
          chill: { rate: 1.0, pitch: 1.0 },
          "drill-sergeant": { rate: 1.1, pitch: 0.85 },
          patient: { rate: 0.85, pitch: 1.05 },
          hype: { rate: 1.1, pitch: 1.15 },
        };
        const s = settings[personality] || settings.chill;
        utterance.rate = s.rate;
        utterance.pitch = s.pitch;
        utterance.volume = 1;

        // Find best available voice
        if (synthRef.current) {
          const voices = synthRef.current.getVoices();

          // Priority: natural voices first
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
            if (voice) {
              utterance.voice = voice;
              break;
            }
          }
        }

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => {
          setIsSpeaking(false);
          resolve();
        };
        utterance.onerror = () => {
          setIsSpeaking(false);
          resolve();
        };

        synthRef.current.speak(utterance);
      });
    },
    []
  );

  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  // Toggle always-on mode
  const setAlwaysOn = useCallback((on: boolean) => {
    setMode(on ? "always-on" : "push-to-talk");
    if (!on && isListening) {
      stopListening();
    }
  }, [isListening, stopListening]);

  return {
    isListening,
    isSpeaking,
    transcript,
    supported,
    mode,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    clearTranscript,
    setAlwaysOn,
  };
}
