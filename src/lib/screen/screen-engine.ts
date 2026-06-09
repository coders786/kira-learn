// ===== Screen Engine v3 =====
// Fixed: video element loading, frame capture reliability, analysis callbacks
//
// How it works:
// 1. getDisplayMedia → video stream
// 2. Wait for video to actually load frames (loadeddata event)
// 3. Periodic canvas capture → base64 JPEG
// 4. Frame change detection (fingerprint comparison)
// 5. If changed → Gemini vision analysis
// 6. Analysis callback fires with structured result

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ScreenAnalysis {
  app: string;
  page: string;
  action: string;
  notable: string;
  shouldComment: boolean;
  comment: string;
  urgency: "low" | "medium" | "high";
  rawText: string;
}

const CONFIG = {
  captureWidth: 800,
  captureHeight: 450,
  jpegQuality: 0.6,
  liveIntervalMs: 4000,
  periodicIntervalMs: 10000,
  maxVisionCallsPerMin: 6,
};

export class ScreenEngine {
  private genAI: GoogleGenerativeAI;
  private visionModel: any;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Stream
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;

  // Analysis
  private lastFrameBase64 = "";
  private lastAnalysis: ScreenAnalysis | null = null;
  private isActive = false;
  private mode: "live" | "periodic" = "live";
  private isAnalyzing = false;

  // Timers
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private visionCallTimes: number[] = [];

  // Teaching context
  private tool = "";
  private realGoal = "";
  private personality = "chill";
  private recentMessages = "";

  // Callbacks stored as mutable refs (avoids stale closures)
  private onAnalysisCb: ((analysis: ScreenAnalysis, frame: string) => void) | null = null;
  private onStreamEndCb: (() => void) | null = null;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.visionModel = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: 150,
      },
    });
    this.canvas = document.createElement("canvas");
    this.canvas.width = CONFIG.captureWidth;
    this.canvas.height = CONFIG.captureHeight;
    this.ctx = this.canvas.getContext("2d")!;
  }

  setTeachingContext(tool: string, realGoal: string, personality: string) {
    this.tool = tool;
    this.realGoal = realGoal;
    this.personality = personality;
  }

  setRecentMessages(messages: string) {
    this.recentMessages = messages.slice(-500);
  }

  // ===== Update callbacks (call when they change to avoid stale closures) =====
  setCallbacks(
    onAnalysis: (analysis: ScreenAnalysis, frame: string) => void,
    onStreamEnd?: () => void
  ) {
    this.onAnalysisCb = onAnalysis;
    this.onStreamEndCb = onStreamEnd || null;
  }

  // ===== Start screen capture =====
  async startCapture(
    mode: "live" | "periodic",
    onAnalysis: (analysis: ScreenAnalysis, frame: string) => void,
    onStreamEnd?: () => void
  ): Promise<boolean> {
    this.mode = mode;
    this.onAnalysisCb = onAnalysis;
    this.onStreamEndCb = onStreamEnd || null;

    try {
      // Get screen stream
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 5 },
        },
        audio: false,
      });

      // Create video element
      this.videoEl = document.createElement("video");
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      this.videoEl.setAttribute("playsinline", "");
      this.videoEl.srcObject = this.stream;

      // CRITICAL: Wait for video to actually load frames
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Video load timeout"));
        }, 5000);

        this.videoEl!.addEventListener("loadeddata", () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });

        this.videoEl!.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("Video load error"));
        }, { once: true });

        // Start playing
        this.videoEl!.play().catch(reject);
      });

      console.log("[ScreenEngine] Video loaded, size:", this.videoEl.videoWidth, "x", this.videoEl.videoHeight);

      // Handle stream end
      this.stream.getVideoTracks()[0].addEventListener("ended", () => {
        console.log("[ScreenEngine] Stream ended by user");
        this.stop();
        this.onStreamEndCb?.();
      });

      this.isActive = true;

      // Capture initial frame after a small delay to ensure rendering
      await new Promise(r => setTimeout(r, 500));

      const firstFrame = this.captureFrame();
      if (firstFrame) {
        this.lastFrameBase64 = firstFrame;
        console.log("[ScreenEngine] First frame captured, length:", firstFrame.length);
        // Analyze first frame
        await this.analyzeFrame(firstFrame);
      } else {
        console.warn("[ScreenEngine] Could not capture first frame — video may not be ready");
      }

      // Start capture loop
      const interval = mode === "live" ? CONFIG.liveIntervalMs : CONFIG.periodicIntervalMs;
      this.startCaptureLoop(interval);

      return true;
    } catch (error) {
      console.error("[ScreenEngine] Capture failed:", error);
      this.isActive = false;
      return false;
    }
  }

  // ===== Capture loop =====
  private startCaptureLoop(intervalMs: number) {
    if (this.captureTimer) clearInterval(this.captureTimer);

    this.captureTimer = setInterval(async () => {
      if (!this.isActive || !this.videoEl || this.isAnalyzing) return;

      const frame = this.captureFrame();
      if (!frame) return;

      const changed = this.hasFrameChanged(frame);
      this.lastFrameBase64 = frame;

      if (changed && this.canCallVision()) {
        await this.analyzeFrame(frame);
      }
    }, intervalMs);
  }

  // ===== Frame change detection =====
  private hasFrameChanged(newFrame: string): boolean {
    if (!this.lastFrameBase64) return true;

    // Quick length check
    const lenDiff = Math.abs(newFrame.length - this.lastFrameBase64.length);
    const lenRatio = lenDiff / this.lastFrameBase64.length;
    if (lenRatio < 0.003) {
      // Very similar length — check content fingerprints
      const chunkSize = 40;
      const positions = [
        [0, chunkSize],
        [Math.floor(newFrame.length * 0.25), Math.floor(newFrame.length * 0.25) + chunkSize],
        [Math.floor(newFrame.length * 0.5), Math.floor(newFrame.length * 0.5) + chunkSize],
        [Math.floor(newFrame.length * 0.75), Math.floor(newFrame.length * 0.75) + chunkSize],
        [newFrame.length - chunkSize, newFrame.length],
      ];

      for (const [start, end] of positions) {
        const newChunk = newFrame.substring(start, end);
        const oldChunk = this.lastFrameBase64.substring(start, end);
        if (newChunk !== oldChunk) return true;
      }
      return false; // All chunks match — no change
    }
    return true;
  }

  // ===== Vision rate limit =====
  private canCallVision(): boolean {
    const now = Date.now();
    this.visionCallTimes = this.visionCallTimes.filter(t => now - t < 60000);
    return this.visionCallTimes.length < CONFIG.maxVisionCallsPerMin;
  }

  // ===== Analyze frame with Gemini vision =====
  private async analyzeFrame(frame: string): Promise<void> {
    if (this.isAnalyzing) return;
    this.isAnalyzing = true;
    this.visionCallTimes.push(Date.now());

    const prompt = this.buildVisionPrompt();

    try {
      const result = await this.visionModel.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: frame,
          },
        },
      ]);

      const text = result.response.text().trim();
      const analysis = this.parseAnalysis(text);

      this.lastAnalysis = analysis;
      this.onAnalysisCb?.(analysis, frame);
    } catch (error: any) {
      console.error("[ScreenEngine] Vision failed:", error?.message || error);
    } finally {
      this.isAnalyzing = false;
    }
  }

  // ===== Vision prompt =====
  private buildVisionPrompt(): string {
    return `You are Kira, an AI learning companion looking at your student's screen.

Student learning: ${this.tool}
Real goal: ${this.realGoal}
Personality: ${this.personality}

Analyze the screenshot. Respond EXACTLY in this format:

APP: what app/website (1-3 words)
PAGE: what page/section (1-5 words)
ACTION: what they're doing (1-5 words)
NOTABLE: anything important visible — errors, form fields, buttons, data, warnings (1 sentence)
URGENCY: low or medium or high
SHOULD_COMMENT: yes or no
COMMENT: if yes, what you'd say as their friend. Max 2 sentences. Lowercase. Casual. No "I can see your screen". Just reference things naturally. If no, write nothing.

Comment rules:
- YES if: error/mistake visible, new important page, stuck (same page), something to celebrate
- NO if: nothing changed, minor scroll, just observing
- For errors/wrong values → urgency: high
- For page changes → urgency: medium
- For observation → urgency: low

Recent conversation:
${this.recentMessages}`;
  }

  // ===== Parse structured response =====
  private parseAnalysis(text: string): ScreenAnalysis {
    const lines = text.split("\n").filter(l => l.trim());
    const get = (key: string): string => {
      const line = lines.find(l => l.toUpperCase().startsWith(key.toUpperCase() + ":"));
      return line ? line.substring(line.indexOf(":") + 1).trim() : "";
    };

    const shouldComment = get("SHOULD_COMMENT").toLowerCase();
    const comment = get("COMMENT");
    const urgency = get("URGENCY").toLowerCase() as "low" | "medium" | "high";

    return {
      app: get("APP"),
      page: get("PAGE"),
      action: get("ACTION"),
      notable: get("NOTABLE"),
      shouldComment: shouldComment === "yes" && comment.length > 0,
      comment,
      urgency: urgency || "low",
      rawText: text,
    };
  }

  // ===== Capture frame =====
  captureFrame(): string | null {
    if (!this.videoEl) {
      console.warn("[ScreenEngine] No video element");
      return null;
    }

    try {
      if (this.videoEl.videoWidth === 0 || this.videoEl.videoHeight === 0) {
        console.warn("[ScreenEngine] Video has no frames yet");
        return null;
      }

      this.ctx.drawImage(
        this.videoEl,
        0, 0,
        CONFIG.captureWidth,
        CONFIG.captureHeight
      );

      const dataUrl = this.canvas.toDataURL("image/jpeg", CONFIG.jpegQuality);
      return dataUrl.split(",")[1];
    } catch (err) {
      console.error("[ScreenEngine] Frame capture error:", err);
      return null;
    }
  }

  // ===== Get current frame for user messages =====
  getCurrentFrame(): string | null {
    if (!this.isActive || !this.videoEl) return null;
    return this.captureFrame();
  }

  // ===== Stop =====
  stop() {
    this.isActive = false;
    this.isAnalyzing = false;

    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }

    this.lastFrameBase64 = "";
    this.lastAnalysis = null;
    this.visionCallTimes = [];
  }

  get running(): boolean {
    return this.isActive && this.stream !== null && this.stream.active;
  }

  get hasStream(): boolean {
    return this.stream !== null && this.stream.active;
  }

  get lastScreenAnalysis(): ScreenAnalysis | null {
    return this.lastAnalysis;
  }
}
