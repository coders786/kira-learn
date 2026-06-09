"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ScreenIntelligence } from "@/lib/screen/screen-intelligence";
import { SCREEN_TEACHING_PROMPT } from "@/lib/ai/screen-prompts";

// ===== Screen Intelligence Hook =====
// Manages the Gemini Live session with screen awareness
// Handles: screen capture, frame streaming, AI responses

export function useScreenIntel() {
  const [isActive, setIsActive] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastAIResponse, setLastAIResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const engineRef = useRef<ScreenIntelligence | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Initialize engine
  const init = useCallback((apiKey: string) => {
    if (engineRef.current) return;
    engineRef.current = new ScreenIntelligence(apiKey);
  }, []);

  // Start the full session
  const startSession = useCallback(
    async (apiKey: string, tool: string, realGoal: string, personality: string) => {
      if (!engineRef.current) init(apiKey);

      const prompt = SCREEN_TEACHING_PROMPT(tool, realGoal, personality);

      try {
        if (!engineRef.current) return;
        await engineRef.current.start(
          prompt,
          // onResponse
          (text: string) => {
            if (text) {
              setLastAIResponse(text);
            }
          },
          // onError
          (err: Error) => {
            setError(err.message);
            setIsActive(false);
          }
        );
        setIsActive(true);
        setError(null);
      } catch (e: any) {
        setError(e.message || "Failed to start screen intelligence");
      }
    },
    [init]
  );

  // Start screen capture
  const startCapture = useCallback(async () => {
    if (!engineRef.current) return false;
    const success = await engineRef.current.startScreenCapture();
    setIsCapturing(success);
    return success;
  }, []);

  // Stop screen capture
  const stopCapture = useCallback(() => {
    engineRef.current?.stopScreenCapture();
    setIsCapturing(false);
  }, []);

  // Send text in the live session
  const sendText = useCallback((text: string) => {
    engineRef.current?.sendText(text);
  }, []);

  // Set capture rate based on activity
  const setCaptureRate = useCallback((speaking: boolean) => {
    engineRef.current?.setCaptureRate(speaking);
  }, []);

  // Stop everything
  const stop = useCallback(() => {
    engineRef.current?.stop();
    setIsActive(false);
    setIsCapturing(false);
    setLastAIResponse("");
  }, []);

  // Frame stats polling
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      if (engineRef.current) {
        setFrameCount(engineRef.current.frameStats.count);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [isActive]);

  // Cleanup
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  return {
    isActive,
    isCapturing,
    lastAIResponse,
    error,
    frameCount,
    init,
    startSession,
    startCapture,
    stopCapture,
    sendText,
    setCaptureRate,
    stop,
    clearResponse: () => setLastAIResponse(""),
  };
}
