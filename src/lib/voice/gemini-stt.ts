// ===== Gemini Speech-to-Text Engine =====
// Inspired by Wispr Flow's approach: capture audio, send to AI for transcription
// Instead of browser's SpeechRecognition (which hallucinates in noise),
// we use Gemini's audio understanding for accurate, context-aware transcription.
//
// Pipeline:
// 1. getUserMedia → microphone stream
// 2. MediaRecorder → audio chunks (webm/opus)
// 3. AudioContext + AnalyserNode → Voice Activity Detection (VAD)
// 4. When speech ends (silence after speech) → compile audio blob
// 5. Send to Gemini API → get accurate transcription
// 6. If no speech detected (just noise) → return empty string
//
// Why Gemini instead of Web Speech API:
// - Gemini is context-aware (we pass conversation context)
// - Gemini doesn't hallucinate words in noise
// - Gemini handles accents, slang, technical terms
// - Gemini can self-correct and format output

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface STTConfig {
  apiKey: string;
  context?: string; // Recent conversation context for better transcription
  language?: string; // Language hint
  maxChunkDuration?: number; // Max recording duration before auto-send (ms)
  silenceThreshold?: number; // Silence detection threshold (0-1)
  silenceDuration?: number; // How long silence before processing (ms)
}

export interface STTResult {
  text: string;
  confidence: "high" | "medium" | "low";
  duration: number; // Audio duration in ms
  wasSpeech: boolean; // Whether actual speech was detected vs just noise
}

export class GeminiSTT {
  private genAI: GoogleGenerativeAI;
  private audioModel: any;
  private config: Required<STTConfig>;

  // Audio capture state
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Blob[] = [];

  // VAD state
  private isSpeaking = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private speechStartTime = 0;
  private maxChunkTimer: ReturnType<typeof setTimeout> | null = null;
  private vadInterval: ReturnType<typeof setInterval> | null = null;
  private isActive = false;

  // Energy tracking for VAD
  private energyHistory: number[] = [];
  private readonly ENERGY_HISTORY_SIZE = 10;
  private readonly SPEECH_ENERGY_THRESHOLD = 0.015; // Tuned for typical mic
  private readonly SILENCE_ENERGY_THRESHOLD = 0.008;

  // Callbacks
  private onResult: ((result: STTResult) => void) | null = null;
  private onSpeakingChange: ((speaking: boolean) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;

  // Processing lock
  private isProcessing = false;

  constructor(config: STTConfig) {
    this.config = {
      apiKey: config.apiKey,
      context: config.context || "",
      language: config.language || "en",
      maxChunkDuration: config.maxChunkDuration || 15000, // 15s max before auto-send
      silenceThreshold: config.silenceThreshold || 0.008,
      silenceDuration: config.silenceDuration || 1500, // 1.5s silence = speech ended
    };

    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
    this.audioModel = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.1, // Low temp for accurate transcription
        topP: 0.95,
        maxOutputTokens: 300,
      },
    });
  }

  // ===== Set conversation context for better transcription =====
  setContext(context: string) {
    this.config.context = context;
  }

  // ===== Start microphone + VAD =====
  async start(
    onResult: (result: STTResult) => void,
    onSpeakingChange: (speaking: boolean) => void,
    onError: (error: Error) => void
  ): Promise<boolean> {
    this.onResult = onResult;
    this.onSpeakingChange = onSpeakingChange;
    this.onError = onError;

    try {
      // Get microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Set up audio analysis for VAD
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);

      // Start recording
      this.startRecording();

      // Start VAD loop
      this.isActive = true;
      this.startVAD();

      return true;
    } catch (error: any) {
      console.error("[GeminiSTT] Start failed:", error);
      onError(error);
      return false;
    }
  }

  // ===== Start MediaRecorder =====
  private startRecording() {
    this.chunks = [];

    // Use webm/opus for good quality and small size
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg;codecs=opus";

    this.mediaRecorder = new MediaRecorder(this.stream!, { mimeType });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.start(200); // Collect chunks every 200ms

    // Max chunk timer — auto-send after max duration
    this.maxChunkTimer = setTimeout(() => {
      if (this.chunks.length > 0) {
        this.processAudio();
      }
    }, this.config.maxChunkDuration);
  }

  // ===== Voice Activity Detection loop =====
  private startVAD() {
    const dataArray = new Float32Array(this.analyser!.fftSize);

    this.vadInterval = setInterval(() => {
      if (!this.isActive || !this.analyser) return;

      // Get audio energy (RMS)
      this.analyser.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      // Track energy history for adaptive threshold
      this.energyHistory.push(rms);
      if (this.energyHistory.length > this.ENERGY_HISTORY_SIZE) {
        this.energyHistory.shift();
      }

      // Calculate adaptive threshold based on ambient noise
      const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
      const speechThreshold = Math.max(this.SPEECH_ENERGY_THRESHOLD, avgEnergy * 2.5);
      const silenceThreshold = Math.max(this.SILENCE_ENERGY_THRESHOLD, avgEnergy * 1.5);

      if (rms > speechThreshold) {
        // Speech detected
        if (!this.isSpeaking) {
          this.isSpeaking = true;
          this.speechStartTime = Date.now();
          this.onSpeakingChange?.(true);
        }

        // Clear silence timer (speech is ongoing)
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else if (this.isSpeaking && rms < silenceThreshold) {
        // Silence after speech
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            // Speech has ended — process audio
            this.isSpeaking = false;
            this.onSpeakingChange?.(false);
            this.speechStartTime = 0;

            if (this.chunks.length > 0) {
              this.processAudio();
            }
          }, this.config.silenceDuration);
        }
      }
    }, 100); // Check every 100ms
  }

  // ===== Process recorded audio through Gemini =====
  private async processAudio() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Reset recording
    const currentChunks = [...this.chunks];
    this.chunks = [];

    // Clear max chunk timer and restart
    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
      this.maxChunkTimer = null;
    }

    // Restart recording for next utterance
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      try { this.mediaRecorder.stop(); } catch {}
    }
    setTimeout(() => {
      if (this.isActive && this.stream) {
        this.startRecording();
      }
    }, 100);

    if (currentChunks.length === 0) {
      this.isProcessing = false;
      return;
    }

    const audioDuration = Date.now() - (this.speechStartTime || Date.now());

    try {
      // Compile audio blob
      const mimeType = currentChunks[0].type || "audio/webm";
      const audioBlob = new Blob(currentChunks, { type: mimeType });

      // Skip very short audio (< 300ms) — probably just noise
      if (audioBlob.size < 1000) {
        this.isProcessing = false;
        return;
      }

      // Convert to base64
      const base64Audio = await this.blobToBase64(audioBlob);

      // Send to Gemini for transcription
      const prompt = this.buildTranscriptionPrompt();

      const result = await this.audioModel.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Audio,
          },
        },
      ]);

      const text = result.response.text().trim();

      // Check if Gemini says it's just noise/silence
      const isNoise = /no (speech|voice|audio|talking|words)|just (noise|silence|background)|empty|nothing|unintelligible|cannot (hear|understand|make out)|inaudible|no_speech|no clear speech|only (noise|silence|background)|no audible/i.test(text);

      if (text && !isNoise && text.length > 1) {
        // Clean up the transcription (remove quotes, formatting)
        const cleanText = text
          .replace(/^["']|["']$/g, "") // Remove surrounding quotes
          .replace(/\[.*?\]/g, "") // Remove bracketed notes like [laughs]
          .replace(/^(Transcript|Transcription|Text|Speech|User said|They said|He said|She said):\s*/i, "")
          .trim();

        if (cleanText) {
          this.onResult?.({
            text: cleanText,
            confidence: text.length > 10 ? "high" : "medium",
            duration: audioDuration,
            wasSpeech: true,
          });
        }
      }
      // If noise/silence — don't send anything (stay quiet)

    } catch (error: any) {
      console.error("[GeminiSTT] Transcription failed:", error?.message || error);
      // Don't call onError for transcription failures — they're not critical
    } finally {
      this.isProcessing = false;
    }
  }

  // ===== Build context-aware transcription prompt =====
  private buildTranscriptionPrompt(): string {
    const parts = [
      "Transcribe this audio accurately.",
      "Return ONLY the transcribed text, nothing else.",
      "If the audio contains only noise, silence, background sounds, or no clear speech, respond with just: NO_SPEECH",
      "Do not add punctuation that wasn't spoken.",
      "Do not add commentary or description.",
    ];

    if (this.config.language) {
      parts.push(`The language is likely ${this.config.language === "en" ? "English" : this.config.language}.`);
    }

    if (this.config.context) {
      parts.push(`Context: The user is having a conversation about: ${this.config.context.slice(-200)}`);
      parts.push("Use this context to resolve ambiguous words.");
    }

    return parts.join(" ");
  }

  // ===== Convert blob to base64 =====
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ===== Force process current audio (e.g., on manual stop) =====
  async flush(): Promise<void> {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
      this.maxChunkTimer = null;
    }

    this.isSpeaking = false;
    this.onSpeakingChange?.(false);

    if (this.chunks.length > 0) {
      await this.processAudio();
    }
  }

  // ===== Stop everything =====
  stop() {
    this.isActive = false;
    this.isSpeaking = false;

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
      this.maxChunkTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      try { this.mediaRecorder.stop(); } catch {}
    }
    this.mediaRecorder = null;

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    this.analyser = null;
    this.chunks = [];
    this.energyHistory = [];
  }

  get speaking(): boolean {
    return this.isSpeaking;
  }

  get active(): boolean {
    return this.isActive;
  }
}
