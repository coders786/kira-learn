// ===== Screen Engine v2 =====
// Replaces the broken Gemini Live approach with reliable periodic vision analysis
// Uses standard @google/generative-ai vision model (gemini-2.0-flash)
//
// How it works:
// 1. Captures screen via getDisplayMedia
// 2. Every N seconds, captures a frame via canvas
// 3. Detects if frame changed (base64 comparison)
// 4. If changed, sends to Gemini vision for analysis
// 5. Returns structured analysis for trigger system

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
  liveIntervalMs: 4000,       // Check frame every 4s in live mode
  periodicIntervalMs: 10000,  // Check frame every 10s in periodic mode
  maxVisionCallsPerMin: 6,    // Rate limit vision API
};

export class ScreenEngine {
  private genAI: GoogleGenerativeAI;
  private visionModel: any;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Stream state
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;

  // Analysis state
  private lastFrameBase64 = "";
  private lastAnalysis: ScreenAnalysis | null = null;
  private isActive = false;
  private mode: "live" | "periodic" = "live";

  // Timers
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private visionCallTimes: number[] = [];

  // Callbacks
  private onAnalysis: ((analysis: ScreenAnalysis, frame: string) => void) | null = null;
  private onStreamEnd: (() => void) | null = null;

  // Teaching context for vision prompt
  private tool = "";
  private realGoal = "";
  private personality = "chill";
  private recentMessages = "";

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

  // ===== Start screen capture =====
  async startCapture(
    mode: "live" | "periodic",
    onAnalysis: (analysis: ScreenAnalysis, frame: string) => void,
    onStreamEnd?: () => void
  ): Promise<boolean> {
    this.mode = mode;
    this.onAnalysis = onAnalysis;
    this.onStreamEnd = onStreamEnd || null;

    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 5 },
        },
        audio: false,
      });

      // Create hidden video element
      this.videoEl = document.createElement("video");
      this.videoEl.srcObject = this.stream;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      await this.videoEl.play();

      // Handle user stopping via browser bar
      this.stream.getVideoTracks()[0].addEventListener("ended", () => {
        this.stop();
        this.onStreamEnd?.();
      });

      this.isActive = true;

      // Wait for first frame to load
      await new Promise(r => setTimeout(r, 800));

      // Capture initial frame
      const firstFrame = this.captureFrame();
      if (firstFrame) {
        this.lastFrameBase64 = firstFrame;
        // Analyze first frame immediately
        await this.analyzeFrame(firstFrame);
      }

      // Start periodic capture loop
      const interval = mode === "live" ? CONFIG.liveIntervalMs : CONFIG.periodicIntervalMs;
      this.startCaptureLoop(interval);

      return true;
    } catch (error) {
      console.error("[ScreenEngine] Capture failed:", error);
      this.isActive = false;
      return false;
    }
  }

  // ===== Capture loop — checks for changes and triggers analysis =====
  private startCaptureLoop(intervalMs: number) {
    if (this.captureTimer) clearInterval(this.captureTimer);

    this.captureTimer = setInterval(async () => {
      if (!this.isActive || !this.videoEl) return;

      const frame = this.captureFrame();
      if (!frame) return;

      // Check if frame changed
      const changed = this.hasFrameChanged(frame);
      this.lastFrameBase64 = frame;

      if (changed) {
        // Rate limit vision calls
        if (this.canCallVision()) {
          await this.analyzeFrame(frame);
        }
      }
    }, intervalMs);
  }

  // ===== Frame change detection (fast, no API call) =====
  private hasFrameChanged(newFrame: string): boolean {
    if (!this.lastFrameBase64) return true;

    // Quick length check
    const lenDiff = Math.abs(newFrame.length - this.lastFrameBase64.length);
    const lenRatio = lenDiff / this.lastFrameBase64.length;
    if (lenRatio < 0.005) {
      // Very similar length — check content fingerprints
      // Compare start, middle, and end chunks
      const chunkSize = 50;
      const newStart = newFrame.substring(0, chunkSize);
      const oldStart = this.lastFrameBase64.substring(0, chunkSize);
      const newMid = newFrame.substring(newFrame.length / 2, newFrame.length / 2 + chunkSize);
      const oldMid = this.lastFrameBase64.substring(this.lastFrameBase64.length / 2, this.lastFrameBase64.length / 2 + chunkSize);
      const newEnd = newFrame.substring(newFrame.length - chunkSize);
      const oldEnd = this.lastFrameBase64.substring(this.lastFrameBase64.length - chunkSize);

      if (newStart === oldStart && newMid === oldMid && newEnd === oldEnd) {
        return false; // Frames are essentially identical
      }
    }

    return true;
  }

  // ===== Check vision API rate limit =====
  private canCallVision(): boolean {
    const now = Date.now();
    // Remove calls older than 60 seconds
    this.visionCallTimes = this.visionCallTimes.filter(t => now - t < 60000);
    return this.visionCallTimes.length < CONFIG.maxVisionCallsPerMin;
  }

  // ===== Analyze a frame with Gemini vision =====
  private async analyzeFrame(frame: string): Promise<void> {
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
      this.onAnalysis?.(analysis, frame);
    } catch (error: any) {
      console.error("[ScreenEngine] Vision analysis failed:", error?.message || error);
      // Don't crash — just skip this frame
    }
  }

  // ===== Build the vision analysis prompt =====
  private buildVisionPrompt(): string {
    return `You are Kira, an AI learning companion. You are looking at your student's screen.

Student is learning: ${this.tool}
Their real goal: ${this.realGoal}
Your personality: ${this.personality}

Analyze what you see. Respond EXACTLY in this format (no markdown, no backticks):

APP: what app/website is visible (1-3 words)
PAGE: what page/section they're on (1-5 words)
ACTION: what they appear to be doing (1-5 words)
NOTABLE: anything important visible — errors, warnings, form fields, buttons, data (1 sentence)
URGENCY: low or medium or high (high = error/mistake visible, medium = progress/action needed, low = just observing)
SHOULD_COMMENT: yes or no (yes = something worth saying to the student, no = nothing notable)
COMMENT: if SHOULD_COMMENT is yes, write what you'd say as their friend sitting next to them. Max 2 sentences. Lowercase. Casual. No corporate speak. No "I can see your screen". Just reference things naturally. If no, write nothing.

Rules for SHOULD_COMMENT:
- Comment if you see an error, mistake, or wrong value
- Comment if they moved to a new important page
- Comment if they seem stuck (same page, nothing happening)
- Comment if you see something worth celebrating (green checkmark, success message)
- Do NOT comment if nothing changed or it's just a minor scroll
- Do NOT comment if screen is just showing the same thing as before

Recent conversation context:
${this.recentMessages}`;
  }

  // ===== Parse the structured response =====
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
      comment: comment,
      urgency: urgency || "low",
      rawText: text,
    };
  }

  // ===== Capture current frame as base64 =====
  captureFrame(): string | null {
    if (!this.videoEl) return null;

    try {
      if (this.videoEl.videoWidth === 0 || this.videoEl.videoHeight === 0) return null;

      this.ctx.drawImage(
        this.videoEl,
        0, 0,
        CONFIG.captureWidth,
        CONFIG.captureHeight
      );

      const dataUrl = this.canvas.toDataURL("image/jpeg", CONFIG.jpegQuality);
      return dataUrl.split(",")[1]; // Strip data:image/jpeg;base64, prefix
    } catch {
      return null;
    }
  }

  // ===== Get current frame (for sending with user messages) =====
  getCurrentFrame(): string | null {
    if (!this.isActive || !this.videoEl) return null;
    return this.captureFrame();
  }

  // ===== Stop everything =====
  stop() {
    this.isActive = false;

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

  // ===== Status =====
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
