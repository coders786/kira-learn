// ===== Gemini Live Screen Intelligence Engine =====
// Based on research of: Google Gemini Live API, Manus AI computer use,
// Anthropic Claude Computer Use, LiveKit+Gemini integration, yeyu/screen-share-demo
//
// Architecture: Client captures screen via getDisplayMedia -> downscale to JPEG ->
// send as realtime_input.video to Gemini Live session -> model sees screen in real-time
// alongside voice/text -> responds with awareness of what's on screen.
//
// This is how Google AI Studio's "Stream Realtime" screen sharing actually works.

import { GoogleGenAI, Modality, Session } from "@google/genai";

// Frame capture config (matching Google's reference implementation)
const SCREEN_CONFIG = {
  captureWidth: 640,      // Downscale from native resolution
  captureHeight: 360,     // For bandwidth efficiency
  jpegQuality: 0.5,       // Compressed JPEG quality
  captureIntervalMs: 1000, // 1 FPS while speaking, matching LiveKit's default
  idleIntervalMs: 3000,    // 0.33 FPS when idle
  maxConcurrentFrames: 2,  // Never queue more than 2 frames
};

export class ScreenIntelligence {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private pendingFrames = 0;
  private onResponse: ((text: string, audio?: ArrayBuffer) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private isActive = false;
  private lastFrameHash = "";
  private frameCount = 0;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.canvas = document.createElement("canvas");
    this.canvas.width = SCREEN_CONFIG.captureWidth;
    this.canvas.height = SCREEN_CONFIG.captureHeight;
    this.ctx = this.canvas.getContext("2d")!;
  }

  // ===== Start the full live session with screen awareness =====
  async start(
    systemPrompt: string,
    onResponse: (text: string, audio?: ArrayBuffer) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    this.onResponse = onResponse;
    this.onError = onError;
    this.isActive = true;
    this.frameCount = 0;

    try {
      // Connect to Gemini Live API
      this.session = await this.ai.live.connect({
        model: "gemini-2.5-flash-preview-native-audio",
        config: {
          responseModalities: [Modality.TEXT], // Use TEXT for reliability in browser
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
        },
        callbacks: {
          onopen: () => {
            console.log("[ScreenIntel] Gemini Live session opened");
          },
          onmessage: (msg: any) => {
            this.handleMessage(msg);
          },
          onerror: (e: any) => {
            console.error("[ScreenIntel] Session error:", e);
            onError(new Error(e.message || "Session error"));
          },
          onclose: (e: any) => {
            console.log("[ScreenIntel] Session closed:", e.reason);
            this.isActive = false;
          },
        },
      });
    } catch (error: any) {
      console.error("[ScreenIntel] Failed to start:", error);
      onError(error);
    }
  }

  // ===== Start screen capture =====
  async startScreenCapture(): Promise<boolean> {
    try {
      // Get screen stream via browser API
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 5 },
        },
        audio: false,
      });

      // Create video element to decode frames
      this.videoEl = document.createElement("video");
      this.videoEl.srcObject = this.stream;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      await this.videoEl.play();

      // Handle user stopping via browser bar
      this.stream.getVideoTracks()[0].addEventListener("ended", () => {
        this.stopScreenCapture();
      });

      // Start periodic frame capture
      this.startFrameCaptureLoop(SCREEN_CONFIG.captureIntervalMs);

      return true;
    } catch (error) {
      console.error("[ScreenIntel] Screen capture failed:", error);
      return false;
    }
  }

  // ===== Frame capture loop — sends screen frames to Gemini =====
  private startFrameCaptureLoop(intervalMs: number): void {
    if (this.captureTimer) clearInterval(this.captureTimer);

    this.captureTimer = setInterval(() => {
      if (!this.isActive || !this.videoEl || !this.session) return;
      if (this.pendingFrames >= SCREEN_CONFIG.maxConcurrentFrames) return;

      const frame = this.captureFrame();
      if (!frame) return;

      // Check if frame actually changed (skip identical frames)
      if (frame === this.lastFrameHash) return;
      this.lastFrameHash = frame;
      this.frameCount++;
      this.pendingFrames++;

      // Send frame to Gemini as realtime video input
      // This is the exact pattern from Google's multimodal-live-api demos
      try {
        this.session.sendRealtimeInput({
          media: {
            data: frame,
            mimeType: "image/jpeg",
          },
        });
      } catch (e) {
        // Session might have closed
        console.warn("[ScreenIntel] Failed to send frame:", e);
        this.pendingFrames = Math.max(0, this.pendingFrames - 1);
      }
    }, intervalMs);
  }

  // ===== Capture a single frame as base64 JPEG =====
  private captureFrame(): string {
    if (!this.videoEl) return "";

    try {
      // Check video has actual frames loaded
      if (this.videoEl.videoWidth === 0 || this.videoEl.videoHeight === 0) return "";

      this.ctx.drawImage(
        this.videoEl,
        0,
        0,
        SCREEN_CONFIG.captureWidth,
        SCREEN_CONFIG.captureHeight
      );

      // Convert to JPEG base64
      const dataUrl = this.canvas.toDataURL("image/jpeg", SCREEN_CONFIG.jpegQuality);
      return dataUrl.split(",")[1]; // Strip data:image/jpeg;base64, prefix
    } catch {
      return "";
    }
  }

  // ===== Send text message to Gemini =====
  sendText(text: string): void {
    if (!this.session || !this.isActive) return;

    try {
      this.session.sendRealtimeInput({
        text,
      });
    } catch (e) {
      console.error("[ScreenIntel] Failed to send text:", e);
    }
  }

  // ===== Handle messages from Gemini =====
  private handleMessage(msg: any): void {
    this.pendingFrames = Math.max(0, this.pendingFrames - 1);

    // Extract text response
    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.text) {
          this.onResponse?.(part.text, undefined);
        }
        if (part.inlineData) {
          this.onResponse?.("", part.inlineData.data as ArrayBuffer);
        }
      }
    }

    // Handle turn complete
    if (msg.serverContent?.turnComplete) {
      // Turn finished — ready for next input
    }

    // Handle interruption (user barge-in)
    if (msg.serverContent?.interrupted) {
      console.log("[ScreenIntel] Model interrupted (user barge-in detected)");
    }
  }

  // ===== Adjust capture rate based on activity =====
  setCaptureRate(speaking: boolean): void {
    const interval = speaking
      ? SCREEN_CONFIG.captureIntervalMs   // 1 FPS when active
      : SCREEN_CONFIG.idleIntervalMs;     // 0.33 FPS when idle
    this.startFrameCaptureLoop(interval);
  }

  // ===== Stop screen capture =====
  stopScreenCapture(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
    this.lastFrameHash = "";
    this.frameCount = 0;
  }

  // ===== Stop entire session =====
  stop(): void {
    this.isActive = false;
    this.stopScreenCapture();
    if (this.session) {
      try {
        this.session.close();
      } catch {}
      this.session = null;
    }
  }

  // ===== Status =====
  get isRunning(): boolean {
    return this.isActive && this.session !== null;
  }

  get isCapturing(): boolean {
    return this.stream !== null && this.stream.active;
  }

  get frameStats(): { count: number; pending: number } {
    return { count: this.frameCount, pending: this.pendingFrames };
  }
}
