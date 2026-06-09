"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  hasAPIKey,
  getGeminiKey,
  getUserProfile,
  isOnboarded,
  setUserProfile,
  setOnboarded,
  setSessionMessages,
  getSessionMessages,
  addMessage as addMsg,
  getMistakes,
  getProgressNotes,
  getQuests,
  clearAllData,
} from "@/lib/storage";
import {
  PersonalityType,
  PERSONALITIES,
  UserProfile,
  ConversationPhase,
  Message,
  MoodType,
} from "@/lib/types";
import { AIOrchestrator } from "@/lib/ai/orchestrator";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useVoice } from "@/hooks/useVoice";
import PersonalityPicker from "@/components/app/PersonalityPicker";
import ScreenSharePanel from "@/components/app/ScreenSharePanel";
import MistakeBank from "@/components/app/MistakeBank";
import DailyQuest from "@/components/app/DailyQuest";
import Sidebar from "@/components/app/Sidebar";

function uid(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

type OnboardStep = "greeting" | "goal-discovery" | "personality-pick" | "screen-permission" | "teaching";

export default function LearnPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [step, setStep] = useState<OnboardStep>("greeting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showMistakeBank, setShowMistakeBank] = useState(false);
  const [showQuest, setShowQuest] = useState(false);
  const [mood, setMood] = useState<MoodType>("normal");
  const [autoSpeak, setAutoSpeak] = useState(false); // OFF by default — user opts in
  const [error, setError] = useState<string | null>(null);
  const [orchestrator, setOrchestrator] = useState<AIOrchestrator | null>(null);

  const screenShare = useScreenShare();
  const voice = useVoice();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastUserMsgTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const greetingDone = useRef(false);
  const isSending = useRef(false); // Prevent race conditions

  // ===== Initialize =====
  useEffect(() => {
    if (mounted) return;
    setMounted(true);

    const key = getGeminiKey();
    if (!key) {
      router.push("/");
      return;
    }

    try {
      const orch = new AIOrchestrator(key);
      setOrchestrator(orch);
    } catch (e) {
      setError("Failed to initialize AI. Check your API key.");
      return;
    }

    const existingUser = getUserProfile();
    if (existingUser && isOnboarded()) {
      setUser(existingUser);
      setStep("teaching");
      const prev = getSessionMessages();
      if (prev.length > 0) {
        setMessages(prev);
      }
    }
  }, [mounted, router]);

  // ===== Auto-greeting for new users =====
  useEffect(() => {
    if (!mounted || !orchestrator) return;
    if (user || greetingDone.current) return;
    if (messages.length > 0) return;

    greetingDone.current = true;
    const greeting: Message = {
      id: uid(),
      role: "ai",
      content: "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier.",
      timestamp: Date.now(),
      phase: "greeting",
    };
    setMessages([greeting]);
    setSessionMessages([greeting]);
  }, [mounted, orchestrator, user, messages.length]);

  // ===== Scroll to bottom =====
  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  // ===== Mood Detection =====
  function detectMood(content: string): MoodType {
    const now = Date.now();
    const elapsed = now - lastUserMsgTime.current;
    responseTimes.current.push(elapsed);
    if (responseTimes.current.length > 8) responseTimes.current.shift();
    const avgTime = responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length;
    const lower = content.toLowerCase();

    if (/\b(tired|brain dead|overwhelmed|too much|need a break|exhausted)\b/.test(lower)) return "tired";
    if (/\b(confused|don't understand|lost|what\?|huh|wait what|i don't get)\b/.test(lower)) return "slow";
    if (avgTime < 3000 && /\b(got it|next|cool|yep|understood|makes sense|let's go)\b/.test(lower)) return "in-the-zone";
    return "normal";
  }

  // ===== Add Message =====
  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      const updated = [...prev, msg];
      setSessionMessages(updated);
      return updated;
    });
    addMsg(msg);
  }, []);

  // ===== SEND MESSAGE (main handler — with input validation) =====
  const handleSend = useCallback(async (content: string, isVoiceInput: boolean = false) => {
    if (!content.trim() || isLoading || !orchestrator || isSending.current) return;

    // Prevent race conditions
    isSending.current = true;

    const sanitized = orchestrator.sanitizeInput(content);

    // Handle special inputs (gibberish, empty, hostile) with pre-defined responses
    const specialResponse = orchestrator.getSpecialResponse(sanitized);
    if (specialResponse) {
      const userMsg: Message = {
        id: uid(),
        role: "user",
        content: sanitized.clean || content.trim(),
        timestamp: Date.now(),
        phase: step as ConversationPhase,
        isVoice: isVoiceInput,
      };
      addMessage(userMsg);

      const aiMsg: Message = {
        id: uid(),
        role: "ai",
        content: specialResponse,
        timestamp: Date.now(),
        phase: step as ConversationPhase,
      };
      addMessage(aiMsg);
      if (autoSpeak) voice.speak(specialResponse, user?.personality || "chill");
      isSending.current = false;
      return;
    }

    // Normal flow
    const now = Date.now();
    responseTimes.current.push(now - lastUserMsgTime.current);
    lastUserMsgTime.current = now;
    const detectedMood = detectMood(sanitized.clean);
    setMood(detectedMood);
    setInputText("");
    setError(null);

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: sanitized.clean,
      timestamp: now,
      phase: step === "teaching" ? "teaching" : "goal-discovery",
      isVoice: isVoiceInput,
    };
    addMessage(userMsg);
    setIsLoading(true);

    try {
      if (step === "greeting" || step === "goal-discovery") {
        await handleGoalDiscovery(sanitized.clean);
      } else if (step === "teaching" && user) {
        await handleTeaching(sanitized.clean, isVoiceInput);
      }
    } catch (err: any) {
      console.error("Message error:", err);
      const errMsg: Message = {
        id: uid(),
        role: "ai",
        content: "my bad, something glitched. can you try saying that again?",
        timestamp: Date.now(),
        phase: step as ConversationPhase,
      };
      addMessage(errMsg);
    } finally {
      setIsLoading(false);
      isSending.current = false;
    }
  }, [isLoading, orchestrator, step, user, addMessage, autoSpeak, voice]);

  // ===== Goal Discovery =====
  const handleGoalDiscovery = useCallback(async (userContent: string) => {
    if (!orchestrator) return;

    const result = await orchestrator.discoverGoal(messages, userContent);

    const aiMsg: Message = {
      id: uid(),
      role: "ai",
      content: result.response,
      timestamp: Date.now(),
      phase: "goal-discovery",
    };
    addMessage(aiMsg);
    if (autoSpeak) voice.speak(result.response, "chill");

    if (result.extractedGoal && result.extractedRealGoal) {
      const profile: UserProfile = {
        id: uid(),
        goal: result.extractedGoal,
        realGoal: result.extractedRealGoal,
        tool: result.extractedGoal.replace(/^(i want to learn |teach me |show me )/i, "").trim() || result.extractedGoal,
        personality: "chill",
        learningPreferences: {
          pace: "normal",
          hatesWords: ["synergy", "leverage", "optimize"],
          maxOptions: 2,
        },
        createdAt: Date.now(),
        lastSessionAt: Date.now(),
        totalSessions: 1,
        streakDays: 1,
      };
      setUser(profile);
      setUserProfile(profile);
      setStep("personality-pick");
    }
  }, [orchestrator, messages, addMessage, autoSpeak, voice]);

  // ===== Teaching =====
  const handleTeaching = useCallback(async (userContent: string, isVoiceInput: boolean) => {
    if (!orchestrator || !user) return;

    let screenData: string | undefined;
    if (screenShare.isSharing) {
      screenData = screenShare.captureFrame() || undefined;
    }

    const context = {
      phase: "teaching" as ConversationPhase,
      messages,
      user,
      mistakes: getMistakes(),
      quests: getQuests(),
      progressNotes: getProgressNotes(),
      screenContext: screenData ? { imageData: screenData, timestamp: Date.now() } : undefined,
      mood,
      sessionStart: Date.now(),
      isScreenSharing: screenShare.isSharing,
    };

    const response = await orchestrator.generateResponse(context, userContent, screenData);

    const aiMsg: Message = {
      id: uid(),
      role: "ai",
      content: response,
      timestamp: Date.now(),
      phase: "teaching",
    };
    addMessage(aiMsg);
    if (autoSpeak) voice.speak(response, user.personality);
  }, [orchestrator, user, messages, mood, screenShare, addMessage, autoSpeak, voice]);

  // ===== Personality Selection =====
  const handlePersonalitySelect = useCallback((personality: PersonalityType) => {
    if (!user) return;

    const updated = { ...user, personality };
    setUser(updated);
    setUserProfile(updated);
    setStep("screen-permission");

    const config = PERSONALITIES.find(p => p.id === personality);
    const msg: Message = {
      id: uid(),
      role: "ai",
      content: `okay. i'll be ${config?.name}. let's do this.\n\none thing. to actually help you, i can see your screen while we learn. you can turn it off anytime. i don't save anything. i just look, help, and forget. want to try?`,
      timestamp: Date.now(),
      phase: "screen-permission",
    };
    addMessage(msg);
    if (autoSpeak) voice.speak(msg.content, personality);
  }, [user, addMessage, autoSpeak, voice]);

  // ===== Screen Permission =====
  const handleScreenPermission = useCallback(async (accepted: boolean) => {
    if (accepted) {
      try {
        await screenShare.startSharing();
      } catch (e) {
        // Screen share failed — continue without it
        console.error("Screen share failed:", e);
      }
    }

    setStep("teaching");
    setOnboarded(true);

    const content = accepted ? "yes, share my screen" : "not right now";
    const userMsg: Message = {
      id: uid(),
      role: "user",
      content,
      timestamp: Date.now(),
      phase: "screen-permission",
    };
    addMessage(userMsg);

    if (user && orchestrator) {
      setIsLoading(true);
      try {
        const teachContext = {
          phase: "teaching" as ConversationPhase,
          messages: [...messages, userMsg],
          user,
          mistakes: getMistakes(),
          quests: getQuests(),
          progressNotes: getProgressNotes(),
          mood: "normal" as MoodType,
          sessionStart: Date.now(),
          isScreenSharing: accepted,
        };

        const response = await orchestrator.generateResponse(
          teachContext,
          `${content}. i'm ready to start learning ${user.tool}. where do we begin?`,
          undefined
        );

        const aiMsg: Message = {
          id: uid(),
          role: "ai",
          content: response,
          timestamp: Date.now(),
          phase: "teaching",
        };
        addMessage(aiMsg);
        if (autoSpeak) voice.speak(response, user.personality);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }
  }, [screenShare, user, orchestrator, messages, addMessage, autoSpeak, voice]);

  // ===== Voice Toggle =====
  const handleVoiceToggle = useCallback(() => {
    if (voice.isListening) {
      voice.stopListening();
      if (voice.transcript) {
        handleSend(voice.transcript, true);
        voice.clearTranscript();
      }
    } else {
      voice.stopSpeaking();
      voice.startListening();
    }
  }, [voice, handleSend]);

  // ===== Screen Share Toggle =====
  const toggleScreenShare = useCallback(async () => {
    if (screenShare.isSharing) {
      screenShare.stopSharing();
    } else {
      try {
        await screenShare.startSharing();
      } catch (e) {
        console.error("Screen share failed:", e);
      }
    }
  }, [screenShare]);

  // ===== Restart / Reset =====
  const handleReset = useCallback(() => {
    clearAllData();
    setUser(null);
    setMessages([]);
    setStep("greeting");
    greetingDone.current = false;
    setOnboarded(false);
  }, []);

  if (!mounted) return null;

  const isSharing = screenShare.isSharing;
  const currentPersonality = user?.personality || "chill";

  return (
    <div className="h-screen flex flex-col bg-kira-bg overflow-hidden">
      {/* ===== HEADER ===== */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 h-14 border-b border-kira-border/50 glass">
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="flex items-center gap-2 text-kira-textMuted hover:text-kira-text transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
          <span className="text-sm font-medium tracking-wide">kira</span>
        </button>

        <div className="flex items-center gap-2">
          {/* Phase */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-kira-surface border border-kira-border/50">
            <div className={`w-1.5 h-1.5 rounded-full ${
              step === "teaching" ? "bg-kira-green" : step === "goal-discovery" ? "bg-kira-yellow" : "bg-kira-accent"
            } ${step === "teaching" ? "animate-pulse" : ""}`} />
            <span className="text-[11px] text-kira-textMuted">{step === "teaching" ? "learning" : step.replace("-", " ")}</span>
          </div>

          {/* Mood */}
          {user && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-kira-surface border border-kira-border/50">
              <div className={`w-1.5 h-1.5 rounded-full ${
                mood === "in-the-zone" ? "bg-kira-green" : mood === "tired" ? "bg-kira-yellow" : mood === "slow" ? "bg-kira-blue" : "bg-kira-textMuted/50"
              }`} />
              <span className="text-[11px] text-kira-textMuted">{mood === "in-the-zone" ? "in the zone" : mood}</span>
            </div>
          )}

          {/* Auto-speak toggle */}
          <button
            onClick={() => setAutoSpeak(!autoSpeak)}
            className={`p-2 rounded-lg transition-all text-xs ${
              autoSpeak
                ? "bg-kira-accent/20 text-kira-accent border border-kira-accent/30"
                : "text-kira-textMuted/40 hover:text-kira-textMuted"
            }`}
            title={autoSpeak ? "Auto-speak ON" : "Auto-speak OFF"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {autoSpeak ? (
                <>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                </>
              ) : (
                <>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              )}
            </svg>
          </button>

          {/* Screen share */}
          <button
            onClick={toggleScreenShare}
            className={`p-2 rounded-lg transition-all ${
              isSharing ? "bg-kira-accent/20 text-kira-accent border border-kira-accent/30" : "text-kira-textMuted hover:text-kira-text hover:bg-kira-surfaceLight"
            }`}
            title={isSharing ? "Stop sharing" : "Share screen"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>

          {/* Voice */}
          <button
            onClick={handleVoiceToggle}
            className={`p-2 rounded-lg transition-all ${
              voice.isListening ? "bg-kira-accent/20 text-kira-accent border border-kira-accent/30 pulse-ring relative"
                : voice.isSpeaking ? "bg-kira-green/10 text-kira-green border border-kira-green/20"
                : "text-kira-textMuted hover:text-kira-text hover:bg-kira-surfaceLight"
            }`}
            title={voice.isListening ? "Stop listening" : "Voice input"}
          >
            {voice.isListening ? (
              <div className="flex items-center gap-0.5">
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0s" }} />
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0.15s" }} />
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0.3s" }} />
              </div>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ===== MAIN ===== */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {showSidebar && (
          <Sidebar
            user={user}
            isScreenSharing={isSharing}
            onShowMistakes={() => { setShowMistakeBank(true); setShowSidebar(false); }}
            onShowQuest={() => { setShowQuest(true); setShowSidebar(false); }}
            onReset={handleReset}
            onClose={() => setShowSidebar(false)}
          />
        )}

        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
            <div className="max-w-2xl mx-auto space-y-5">
              {messages.map((msg) => (
                <div key={msg.id} className="message-enter">
                  <MessageBubble message={msg} personality={currentPersonality} />
                </div>
              ))}
              {isLoading && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-kira-accent/20 flex items-center justify-center flex-shrink-0"><span className="text-sm">✦</span></div>
                  <div className="bg-kira-surface border border-kira-border/50 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-kira-accent/60 typing-dot" />
                      <div className="w-2 h-2 rounded-full bg-kira-accent/60 typing-dot" />
                      <div className="w-2 h-2 rounded-full bg-kira-accent/60 typing-dot" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Personality picker */}
          {step === "personality-pick" && (
            <PersonalityPicker onSelect={handlePersonalitySelect} selected={user?.personality || null} />
          )}

          {/* Screen permission */}
          {step === "screen-permission" && (
            <div className="border-t border-kira-border/50 bg-kira-surface/50 p-6 animate-fade-up">
              <div className="max-w-2xl mx-auto flex items-center gap-4">
                <button onClick={() => handleScreenPermission(true)} className="flex-1 py-3 bg-kira-accent hover:bg-kira-accentLight text-white rounded-xl transition-all btn-glow font-medium">yes, share my screen</button>
                <button onClick={() => handleScreenPermission(false)} className="py-3 px-6 bg-kira-surface border border-kira-border text-kira-textMuted rounded-xl hover:text-kira-text transition-colors">not right now</button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-4 py-2 bg-kira-red/10 border-t border-kira-red/20 text-kira-red text-sm text-center">{error}</div>
          )}

          {/* ===== INPUT ===== */}
          <div className="flex-shrink-0 border-t border-kira-border/50 p-4 glass">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inputText.trim()) handleSend(inputText.trim());
              }}
              className="flex items-center gap-3 max-w-2xl mx-auto"
            >
              {voice.isSpeaking && (
                <button type="button" onClick={voice.stopSpeaking} className="p-2.5 rounded-xl bg-kira-red/10 border border-kira-red/20 text-kira-red hover:bg-kira-red/20 transition-colors flex-shrink-0" title="Stop speaking">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              )}

              <input
                type="text"
                value={voice.isListening ? (voice.transcript || "listening...") : inputText}
                onChange={(e) => { if (!voice.isListening) setInputText(e.target.value); }}
                placeholder={voice.isListening ? "speak now..." : step === "greeting" ? "what are you trying to figure out?" : step === "goal-discovery" ? "tell me more..." : "type your response..."}
                disabled={isLoading}
                className={`flex-1 bg-kira-surface border border-kira-border rounded-xl px-4 py-3 text-[15px] text-kira-text placeholder:text-kira-textMuted/40 focus:outline-none focus:border-kira-accent/40 transition-all ${
                  voice.isListening ? "border-kira-accent/40 bg-kira-accent/5" : ""
                } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                maxLength={2000}
              />

              <button type="button" onClick={handleVoiceToggle} disabled={isLoading}
                className={`p-3 rounded-xl transition-all flex-shrink-0 ${
                  voice.isListening ? "bg-kira-accent text-white pulse-ring relative" : "bg-kira-surface border border-kira-border text-kira-textMuted hover:text-kira-text hover:border-kira-accent/30"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>

              <button type="submit" disabled={isLoading || (!inputText.trim() && !voice.isListening)}
                className="p-3 bg-kira-accent text-white rounded-xl hover:bg-kira-accentLight transition-all btn-glow flex-shrink-0 disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-kira-accent"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </div>
        </div>

        {isSharing && (
          <ScreenSharePanel videoRef={screenShare.videoRef} onStop={() => screenShare.stopSharing()} onCapture={screenShare.captureFrame} />
        )}
      </div>

      {showMistakeBank && <MistakeBank onClose={() => setShowMistakeBank(false)} />}
      {showQuest && <DailyQuest onClose={() => setShowQuest(false)} />}
    </div>
  );
}

// ===== Message Bubble =====
function MessageBubble({ message, personality }: { message: Message; personality: string }) {
  const isAI = message.role === "ai";
  return (
    <div className={`flex items-start gap-3 ${isAI ? "" : "flex-row-reverse"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium ${
        isAI ? "bg-kira-accent/20 text-kira-accent" : "bg-kira-green/15 text-kira-green"
      }`}>{isAI ? "✦" : "you"}</div>
      <div className={`max-w-[80%] sm:max-w-[75%] ${
        isAI ? "bg-kira-surface border border-kira-border/40 rounded-2xl rounded-tl-sm" : "bg-kira-accent/8 border border-kira-accent/15 rounded-2xl rounded-tr-sm"
      } px-4 py-3`}>
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-kira-text/90">{message.content}</div>
        <div className="flex items-center gap-2 mt-2">
          {message.isVoice && (
            <span className="text-[10px] text-kira-textMuted/30 flex items-center gap-0.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /></svg>
              voice
            </span>
          )}
          <span className="text-[10px] text-kira-textMuted/25 ml-auto">{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
    </div>
  );
}
