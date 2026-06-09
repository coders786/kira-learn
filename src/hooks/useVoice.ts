"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface VoiceState {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  error: string | null;
  supported: boolean;
}

export function useVoice() {
  const [state, setState] = useState<VoiceState>({
    isListening: false,
    isSpeaking: false,
    transcript: "",
    error: null,
    supported: typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) && !!window.speechSynthesis,
  });

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        const current = event.resultIndex;
        const transcript = event.results[current][0].transcript;
        setState((prev) => ({ ...prev, transcript }));
      };

      recognition.onend = () => {
        setState((prev) => ({ ...prev, isListening: false }));
      };

      recognition.onerror = (event: any) => {
        setState((prev) => ({
          ...prev,
          isListening: false,
          error: event.error,
        }));
      };

      recognitionRef.current = recognition;
      setState((prev) => ({ ...prev, supported: true }));
    }

    synthRef.current = window.speechSynthesis;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;

    setState((prev) => ({ ...prev, transcript: "", error: null }));
    try {
      recognitionRef.current.start();
      setState((prev) => ({ ...prev, isListening: true }));
    } catch (err: any) {
      // Recognition might already be running
      recognitionRef.current.stop();
      setTimeout(() => {
        recognitionRef.current?.start();
        setState((prev) => ({ ...prev, isListening: true }));
      }, 100);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setState((prev) => ({ ...prev, isListening: false }));
  }, []);

  // Speak text aloud with a natural voice
  const speak = useCallback(
    (text: string, personality: string = "chill"): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (!synthRef.current) {
          resolve();
          return;
        }

        // Cancel any ongoing speech
        synthRef.current.cancel();

        // Clean text for speech (remove emoji, special chars)
        const cleanText = text
          .replace(/[\u{1F000}-\u{1FFFF}]/gu, "") // Remove emoji
          .replace(/\.\.\./g, ", ") // Convert ellipsis to pause
          .replace(/\?{2,}/g, "?") // Multiple question marks
          .replace(/!{2,}/g, "!") // Multiple exclamation marks
          .trim();

        const utterance = new SpeechSynthesisUtterance(cleanText);

        // Adjust voice parameters based on personality
        switch (personality) {
          case "chill":
            utterance.rate = 0.95;
            utterance.pitch = 1.0;
            break;
          case "drill-sergeant":
            utterance.rate = 1.1;
            utterance.pitch = 0.9;
            break;
          case "patient":
            utterance.rate = 0.8;
            utterance.pitch = 1.05;
            break;
          case "hype":
            utterance.rate = 1.15;
            utterance.pitch = 1.2;
            break;
        }

        // Try to find a good voice
        const voices = synthRef.current.getVoices();
        const preferredVoices = [
          "Google US English",
          "Microsoft Aria",
          "Samantha",
          "Alex",
          "Google UK English Female",
        ];

        for (const voiceName of preferredVoices) {
          const voice = voices.find((v) => v.name.includes(voiceName));
          if (voice) {
            utterance.voice = voice;
            break;
          }
        }

        // Fallback: use first English voice
        if (!utterance.voice) {
          const englishVoice = voices.find((v) => v.lang.startsWith("en"));
          if (englishVoice) {
            utterance.voice = englishVoice;
          }
        }

        utterance.onstart = () => {
          setState((prev) => ({ ...prev, isSpeaking: true }));
        };

        utterance.onend = () => {
          setState((prev) => ({ ...prev, isSpeaking: false }));
          resolve();
        };

        utterance.onerror = (event) => {
          setState((prev) => ({ ...prev, isSpeaking: false }));
          resolve(); // Don't reject - speech errors are non-critical
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
    setState((prev) => ({ ...prev, isSpeaking: false }));
  }, []);

  const clearTranscript = useCallback(() => {
    setState((prev) => ({ ...prev, transcript: "" }));
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    clearTranscript,
  };
}
