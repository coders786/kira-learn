"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ===== Screen Share Hook v2 =====
// Fixed: ref forwarding, stream lifecycle, proper video binding

export function useScreenShare() {
  const [isSharing, setIsSharing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null); // Mutable ref to avoid stale closures

  const startSharing = useCallback(async (): Promise<boolean> => {
    try {
      // Check if already sharing
      if (streamRef.current) {
        return true;
      }

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 2 },
        },
        audio: false,
      });

      // Store in ref FIRST (avoids stale closure in callbacks)
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsSharing(true);

      // Bind to video element AFTER state update
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(() => {});
        }
      });

      // Handle user stopping via browser bar
      mediaStream.getVideoTracks()[0].addEventListener("ended", () => {
        streamRef.current = null;
        setStream(null);
        setIsSharing(false);
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      });

      return true;
    } catch (err: any) {
      console.error("Screen share error:", err);
      streamRef.current = null;
      setStream(null);
      setIsSharing(false);
      return false;
    }
  }, []);

  const stopSharing = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
    setIsSharing(false);
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return null;

    try {
      // Check video has actual frames
      if (video.videoWidth === 0 || video.videoHeight === 0) return null;

      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvasRef.current = canvas;
      }

      canvas.width = Math.min(video.videoWidth, 640); // Downscale for API
      canvas.height = Math.min(video.videoHeight, 360);

      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.5).split(",")[1];
    } catch (err) {
      console.error("Frame capture error:", err);
      return null;
    }
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    isSharing,
    stream,
    videoRef, // Pass this directly to <video ref={videoRef}>
    startSharing,
    stopSharing,
    captureFrame,
  };
}
