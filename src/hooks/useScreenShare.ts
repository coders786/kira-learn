"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface ScreenShareState {
  isSharing: boolean;
  stream: MediaStream | null;
  error: string | null;
  previewElement: HTMLVideoElement | null;
}

export function useScreenShare() {
  const [state, setState] = useState<ScreenShareState>({
    isSharing: false,
    stream: null,
    error: null,
    previewElement: null,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startSharing = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 1 }, // Low FPS for AI analysis
        },
        audio: false,
      });

      // Handle user stopping share via browser UI
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopSharing();
      });

      setState({
        isSharing: true,
        stream,
        error: null,
        previewElement: videoRef.current,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      return true;
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        error: err.message || "Failed to start screen sharing",
      }));
      return false;
    }
  }, []);

  const stopSharing = useCallback(() => {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
    }
    setState({
      isSharing: false,
      stream: null,
      error: null,
      previewElement: null,
    });
  }, [state.stream]);

  // Capture current frame as base64
  const captureFrame = useCallback((): string | null => {
    if (!state.stream || !videoRef.current) return null;

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current || document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      if (!canvasRef.current) {
        canvasRef.current = canvas;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Compress - convert to JPEG with lower quality for smaller size
      return canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
    } catch (err) {
      console.error("Frame capture error:", err);
      return null;
    }
  }, [state.stream]);

  // Auto-capture periodically
  const startAutoCapture = useCallback(
    (
      callback: (frameData: string) => void,
      intervalMs: number = 10000
    ) => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }

      captureIntervalRef.current = setInterval(() => {
        const frame = captureFrame();
        if (frame) {
          callback(frame);
        }
      }, intervalMs);
    },
    [captureFrame]
  );

  const stopAutoCapture = useCallback(() => {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (state.stream) {
        state.stream.getTracks().forEach((track) => track.stop());
      }
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }
    };
  }, []);

  return {
    ...state,
    videoRef,
    startSharing,
    stopSharing,
    captureFrame,
    startAutoCapture,
    stopAutoCapture,
  };
}
