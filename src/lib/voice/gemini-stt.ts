// ===== Gemini Speech-to-Text Engine v2 =====
// FIX: Gemini generateContent API does NOT support WebM audio.
// Supported formats: WAV, MP3, AIFF, AAC, OGG, FLAC
//
// Solution: Capture raw PCM via AudioContext → encode as WAV → send to Gemini
// This is the exact approach used by Whisper Flow and Gemini Live API docs.
//
// Pipeline:
// 1. getUserMedia → mic stream (mono, 16kHz)
// 2. AudioContext + ScriptProcessorNode → raw PCM Float32 samples
// 3. AnalyserNode → VAD (voice activity detection)
// 4. On speech end → convert Float32 samples to 16-bit PCM WAV
// 5. Send WAV (base64) to Gemini → accurate transcription
// 6. Noise/silence → NO_SPEECH response → ignore

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface STTConfig {
  apiKey: string;
  context?: string;
  language?: string;
  maxChunkDuration?: number;
  silenceDuration?: number;
}

export interface STTResult {
  text: string;
  confidence: "high" | "medium" | "low";
  duration: number;
  wasSpeech: boolean;
}

// ===== WAV encoder: raw PCM Float32 → 16-bit PCM WAV bytes =====
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);      // chunk size
  view.setUint16(20, 1, true);       // PCM format
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);       // block align
  view.setUint16(34, 16, true);      // bits per sample

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  // Convert Float32 to Int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export class GeminiSTT {
  private genAI: GoogleGenerativeAI;
  private audioModel: any;
  private config: Required<STTConfig>;

  // Audio capture
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  // PCM sample buffer
  private pcmBuffer: Float32Array[] = [];
  private recordingBuffer: Float32Array[] = [];
  private isActive = false;

  // VAD state
  private isSpeaking = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private speechStartTime = 0;
  private maxChunkTimer: ReturnType<typeof setTimeout> | null = null;
  private vadInterval: ReturnType<typeof setInterval> | null = null;

  // Energy tracking
  private energyHistory: number[] = [];
  private readonly ENERGY_HISTORY_SIZE = 15;
  private readonly BASE_SPEECH_THRESHOLD = 0.012;
  private readonly BASE_SILENCE_THRESHOLD = 0.006;

  // Callbacks
  private onResult: ((result: STTResult) => void) | null = null;
  private onSpeakingChange: ((speaking: boolean) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;

  // Processing lock
  private isProcessing = false;

  // Debug
  private debugLog: string[] = [];
  private log(msg: string) {
    const entry = `[GeminiSTT] ${msg}`;
    this.debugLog.push(entry);
    if (this.debugLog.length > 50) this.debugLog.shift();
    console.log(entry);
  }

  constructor(config: STTConfig) {
    this.config = {
      apiKey: config.apiKey,
      context: config.context || "",
      language: config.language || "en",
      maxChunkDuration: config.maxChunkDuration || 15000,
      silenceDuration: config.silenceDuration || 1800,
    };

    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
    this.audioModel = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.1,
        topP: 0.95,
        maxOutputTokens: 300,
      },
    });
  }

  setContext(context: string) {
    this.config.context = context;
  }

  // ===== Start mic + VAD + PCM capture =====
  async start(
    onResult: (result: STTResult) => void,
    onSpeakingChange: (speaking: boolean) => void,
    onError: (error: Error) => void
  ): Promise<boolean> {
    this.onResult = onResult;
    this.onSpeakingChange = onSpeakingChange;
    this.onError = onError;

    try {
      this.log("Requesting microphone access...");

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.log("Got mic stream. Setting up AudioContext...");

      // Create AudioContext at 16kHz for optimal Gemini transcription
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.source = this.audioContext.createMediaStreamSource(this.stream);

      // Analyser for VAD
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.85;
      this.source.connect(this.analyser);

      // ScriptProcessor to capture raw PCM samples
      // bufferSize 4096 = ~256ms at 16kHz
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (e) => {
        if (!this.isActive) return;
        const input = e.inputBuffer.getChannelData(0);
        // Copy the buffer (the original gets reused)
        const copy = new Float32Array(input);
        this.pcmBuffer.push(copy);

        // Also accumulate into recording buffer
        if (this.isSpeaking || this.recordingBuffer.length > 0) {
          this.recordingBuffer.push(copy);
        }
      };
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination); // Must connect to destination

      this.isActive = true;
      this.log("Audio pipeline active. Starting VAD...");

      // Start VAD loop
      this.startVAD();

      // Max chunk timer
      this.maxChunkTimer = setTimeout(() => {
        this.log("Max chunk duration reached, processing...");
        if (this.recordingBuffer.length > 0) {
          this.processRecording();
        }
      }, this.config.maxChunkDuration);

      return true;
    } catch (error: any) {
      this.log(`Start failed: ${error.message}`);
      onError(error);
      return false;
    }
  }

  // ===== VAD loop =====
  private startVAD() {
    const dataArray = new Float32Array(this.analyser!.fftSize);

    this.vadInterval = setInterval(() => {
      if (!this.isActive || !this.analyser) return;

      this.analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS energy
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      // Track energy history
      this.energyHistory.push(rms);
      if (this.energyHistory.length > this.ENERGY_HISTORY_SIZE) {
        this.energyHistory.shift();
      }

      // Adaptive threshold: learn the noise floor
      const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
      const speechThreshold = Math.max(this.BASE_SPEECH_THRESHOLD, avgEnergy * 3.0);
      const silenceThreshold = Math.max(this.BASE_SILENCE_THRESHOLD, avgEnergy * 1.8);

      if (rms > speechThreshold) {
        if (!this.isSpeaking) {
          this.isSpeaking = true;
          this.speechStartTime = Date.now();
          this.onSpeakingChange?.(true);
          this.log(`Speech detected (rms=${rms.toFixed(4)}, threshold=${speechThreshold.toFixed(4)})`);
        }
        // Clear silence timer
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else if (this.isSpeaking && rms < silenceThreshold) {
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            this.log(`Speech ended (silence ${this.config.silenceDuration}ms)`);
            this.isSpeaking = false;
            this.onSpeakingChange?.(false);

            if (this.recordingBuffer.length > 0) {
              this.processRecording();
            }
          }, this.config.silenceDuration);
        }
      }
    }, 80);
  }

  // ===== Process accumulated recording =====
  private async processRecording() {
    if (this.isProcessing) {
      this.log("Already processing, skipping");
      return;
    }
    this.isProcessing = true;

    // Grab the buffer
    const chunks = [...this.recordingBuffer];
    this.recordingBuffer = [];

    // Reset max chunk timer
    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
      this.maxChunkTimer = null;
    }
    // Restart max chunk timer
    this.maxChunkTimer = setTimeout(() => {
      if (this.recordingBuffer.length > 0) {
        this.processRecording();
      }
    }, this.config.maxChunkDuration);

    if (chunks.length === 0) {
      this.isProcessing = false;
      return;
    }

    // Merge all Float32 chunks into one
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const audioDuration = (totalLength / 16000) * 1000; // ms
    this.log(`Processing ${merged.length} samples (${audioDuration.toFixed(0)}ms)`);

    // Skip very short audio (< 300ms) — probably just noise burst
    if (audioDuration < 300) {
      this.log("Too short, skipping");
      this.isProcessing = false;
      return;
    }

    try {
      // Encode as WAV
      const wavBuffer = encodeWAV(merged, 16000);
      const wavBase64 = this.arrayBufferToBase64(wavBuffer);

      this.log(`WAV encoded: ${wavBuffer.byteLength} bytes`);

      // Send to Gemini
      const prompt = this.buildTranscriptionPrompt();

      const result = await this.audioModel.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: "audio/wav", // ✅ WAV is supported by Gemini
            data: wavBase64,
          },
        },
      ]);

      const text = result.response.text().trim();
      this.log(`Gemini response: "${text.substring(0, 80)}"`);

      // Check for noise/silence
      const isNoise = /no (speech|voice|audio|talking|words)|just (noise|silence|background)|empty|nothing|unintelligible|cannot (hear|understand|make out)|inaudible|no_speech|no clear speech|only (noise|silence|background)|no audible/i.test(text);

      if (text && !isNoise && text.length > 1) {
        const cleanText = text
          .replace(/^["']|["']$/g, "")
          .replace(/\[.*?\]/g, "")
          .replace(/^(Transcript|Transcription|Text|Speech|User said|They said|He said|She said):\s*/i, "")
          .trim();

        if (cleanText) {
          this.log(`Transcribed: "${cleanText}"`);
          this.onResult?.({
            text: cleanText,
            confidence: cleanText.length > 10 ? "high" : "medium",
            duration: audioDuration,
            wasSpeech: true,
          });
        }
      } else {
        this.log("No speech detected in audio");
      }
    } catch (error: any) {
      this.log(`Transcription error: ${error?.message || error}`);
      // Don't call onError for individual failures
    } finally {
      this.isProcessing = false;
    }
  }

  // ===== Build transcription prompt =====
  private buildTranscriptionPrompt(): string {
    const parts = [
      "Transcribe this audio accurately.",
      "Return ONLY the transcribed text, nothing else.",
      "If the audio contains only noise, silence, background sounds, or no clear speech, respond with just: NO_SPEECH",
      "Do not add punctuation that wasn't spoken.",
      "Do not add commentary or description.",
      "Do not add quotation marks around the transcription.",
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

  // ===== ArrayBuffer → base64 =====
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // ===== Force process current audio =====
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

    if (this.recordingBuffer.length > 0) {
      await this.processRecording();
    }
  }

  // ===== Stop =====
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

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    this.analyser = null;
    this.pcmBuffer = [];
    this.recordingBuffer = [];
    this.energyHistory = [];
  }

  get speaking(): boolean {
    return this.isSpeaking;
  }

  get active(): boolean {
    return this.isActive;
  }

  get debug(): string[] {
    return this.debugLog;
  }
}
