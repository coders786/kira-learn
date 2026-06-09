"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  hasAPIKey, getGeminiKey, getUserProfile, isOnboarded,
  setUserProfile, setOnboarded, setSessionMessages, getSessionMessages,
  addMessage as addMsg, getMistakes, getProgressNotes, getQuests, clearAllData,
} from "@/lib/storage";
import {
  PersonalityType, PERSONALITIES, UserProfile,
  ConversationPhase, Message, MoodType,
} from "@/lib/types";
import { AIOrchestrator } from "@/lib/ai/orchestrator";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useVoice } from "@/hooks/useVoice";
import { useScreenIntel } from "@/hooks/useScreenIntel";
import PersonalityPicker from "@/components/app/PersonalityPicker";
import ScreenSharePanel from "@/components/app/ScreenSharePanel";
import MistakeBank from "@/components/app/MistakeBank";
import DailyQuest from "@/components/app/DailyQuest";
import Sidebar from "@/components/app/Sidebar";

function uid(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

type Step = "greeting" | "goal-discovery" | "personality-pick" | "screen-permission" | "teaching";

export default function LearnPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [step, setStep] = useState<Step>("greeting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showMistakes, setShowMistakes] = useState(false);
  const [showQuest, setShowQuest] = useState(false);
  const [mood, setMood] = useState<MoodType>("normal");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [screenMode, setScreenMode] = useState<"off" | "basic" | "live">("off");
  const [orchestrator, setOrchestrator] = useState<AIOrchestrator | null>(null);

  const screenShare = useScreenShare();
  const voice = useVoice();
  const screenIntel = useScreenIntel();
  const endRef = useRef<HTMLDivElement>(null);
  const lastMsgTime = useRef(Date.now());
  const greeted = useRef(false);
  const sending = useRef(false);

  // Init
  useEffect(() => {
    if (mounted) return;
    setMounted(true);
    const key = getGeminiKey();
    if (!key) { router.push("/"); return; }
    try {
      const orch = new AIOrchestrator(key);
      setOrchestrator(orch);
      screenIntel.init(key);
    } catch { router.push("/"); return; }
    const u = getUserProfile();
    if (u && isOnboarded()) {
      setUser(u);
      setStep("teaching");
      const prev = getSessionMessages();
      if (prev.length) setMessages(prev);
    }
  }, [mounted, router]);

  // Greeting
  useEffect(() => {
    if (!mounted || !orchestrator || user || greeted.current || messages.length) return;
    greeted.current = true;
    const g: Message = { id: uid(), role: "ai", content: "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier.", timestamp: Date.now(), phase: "greeting" };
    setMessages([g]);
    setSessionMessages([g]);
  }, [mounted, orchestrator, user, messages.length]);

  // Scroll
  useEffect(() => { setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }, [messages, isLoading]);

  // Auto-speak
  useEffect(() => {
    if (!autoSpeak || !messages.length) return;
    const last = messages[messages.length - 1];
    if (last.role === "ai" && !voice.isSpeaking) voice.speak(last.content, user?.personality || "chill");
  }, [messages.length, autoSpeak]);

  // Screen intelligence: when AI responds from screen watching, add to messages
  useEffect(() => {
    if (!screenIntel.lastAIResponse || !screenIntel.isActive) return;
    const r = screenIntel.lastAIResponse;
    if (r && r.length > 5) {
      addMessage({ id: uid(), role: "ai", content: r, timestamp: Date.now(), phase: "teaching" });
      screenIntel.clearResponse();
    }
  }, [screenIntel.lastAIResponse]);

  function detectMood(content: string): MoodType {
    const now = Date.now();
    lastMsgTime.current = now;
    const lower = content.toLowerCase();
    if (/\b(tired|brain dead|overwhelmed|exhausted)\b/.test(lower)) return "tired";
    if (/\b(confused|don't understand|lost|what\?|huh)\b/.test(lower)) return "slow";
    return "normal";
  }

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => { const u = [...prev, msg]; setSessionMessages(u); return u; });
    addMsg(msg);
  }, []);

  // ===== SEND =====
  const handleSend = useCallback(async (content: string, isVoice = false) => {
    if (!content.trim() || isLoading || !orchestrator || sending.current) return;
    sending.current = true;
    const sanitized = orchestrator.sanitizeInput(content);
    const special = orchestrator.getSpecialResponse(sanitized);
    if (special) {
      addMessage({ id: uid(), role: "user", content: sanitized.clean || content.trim(), timestamp: Date.now(), phase: step as ConversationPhase, isVoice });
      addMessage({ id: uid(), role: "ai", content: special, timestamp: Date.now(), phase: step as ConversationPhase });
      sending.current = false;
      return;
    }
    const detectedMood = detectMood(sanitized.clean);
    setMood(detectedMood);
    setInputText("");
    addMessage({ id: uid(), role: "user", content: sanitized.clean, timestamp: Date.now(), phase: step === "teaching" ? "teaching" : "goal-discovery", isVoice });
    setIsLoading(true);
    try {
      if (step === "greeting" || step === "goal-discovery") {
        const result = await orchestrator.discoverGoal(messages);
        addMessage({ id: uid(), role: "ai", content: result.response, timestamp: Date.now(), phase: "goal-discovery" });
        if (result.extractedGoal && result.extractedRealGoal) {
          const profile: UserProfile = {
            id: uid(), goal: result.extractedGoal, realGoal: result.extractedRealGoal,
            tool: result.extractedGoal.replace(/^(i want to learn |teach me |show me )/i, "").trim() || result.extractedGoal,
            personality: "chill", learningPreferences: { pace: "normal", hatesWords: ["synergy"], maxOptions: 2 },
            createdAt: Date.now(), lastSessionAt: Date.now(), totalSessions: 1, streakDays: 1,
          };
          setUser(profile); setUserProfile(profile); setStep("personality-pick");
        }
      } else if (step === "teaching" && user) {
        // Check if screen intelligence is active (Live mode)
        if (screenMode === "live" && screenIntel.isActive) {
          screenIntel.sendText(content);
          // Response will come via the screenIntel.lastAIResponse effect
          // Fallback: also use regular orchestrator if screen intel doesn't respond within 8s
          const fallbackTimer = setTimeout(async () => {
            const screenData = screenShare.isSharing ? screenShare.captureFrame() || undefined : undefined;
            const ctx = { phase: "teaching" as ConversationPhase, messages, user, mistakes: getMistakes(), quests: getQuests(), progressNotes: getProgressNotes(), screenContext: screenData ? { imageData: screenData, timestamp: Date.now() } : undefined, mood: detectedMood, sessionStart: Date.now(), isScreenSharing: screenShare.isSharing };
            const r = await orchestrator.generateResponse(ctx, sanitized.clean, screenData);
            addMessage({ id: uid(), role: "ai", content: r, timestamp: Date.now(), phase: "teaching" });
          }, 8000);
          // Clear fallback if screen intel responds
          setTimeout(() => clearTimeout(fallbackTimer), 9000);
        } else {
          // Basic mode or no screen — use regular orchestrator
          const screenData = screenShare.isSharing ? screenShare.captureFrame() || undefined : undefined;
          const ctx = { phase: "teaching" as ConversationPhase, messages, user, mistakes: getMistakes(), quests: getQuests(), progressNotes: getProgressNotes(), screenContext: screenData ? { imageData: screenData, timestamp: Date.now() } : undefined, mood: detectedMood, sessionStart: Date.now(), isScreenSharing: screenShare.isSharing };
          const response = await orchestrator.generateResponse(ctx, sanitized.clean, screenData);
          addMessage({ id: uid(), role: "ai", content: response, timestamp: Date.now(), phase: "teaching" });
        }
      }
    } catch (e) {
      console.error(e);
      addMessage({ id: uid(), role: "ai", content: "something went wrong. try again?", timestamp: Date.now(), phase: step as ConversationPhase });
    } finally { setIsLoading(false); sending.current = false; }
  }, [isLoading, orchestrator, step, user, messages, addMessage, screenShare, screenMode, screenIntel]);

  const handlePersonality = useCallback((p: PersonalityType) => {
    if (!user) return;
    const u = { ...user, personality: p }; setUser(u); setUserProfile(u);
    setStep("screen-permission");
    const c = PERSONALITIES.find(x => x.id === p);
    addMessage({ id: uid(), role: "ai", content: `okay. i'll be ${c?.name}. let's do this.\n\none thing — i can see your screen while we learn. you turn it off anytime. i don't save anything. just look, help, forget.\n\npick how you want screen sharing to work:`, timestamp: Date.now(), phase: "screen-permission" });
  }, [user, addMessage]);

  const handleScreenPerm = useCallback(async (mode: "off" | "basic" | "live") => {
    setScreenMode(mode);
    setStep("teaching"); setOnboarded(true);
    addMessage({ id: uid(), role: "user", content: mode === "live" ? "live screen sharing" : mode === "basic" ? "basic screen sharing" : "no screen sharing", timestamp: Date.now(), phase: "screen-permission" });

    if (mode === "live" && user && getGeminiKey()) {
      // Start Gemini Live session with screen intelligence
      try {
        await screenIntel.startSession(getGeminiKey()!, user.tool, user.realGoal, user.personality);
        await screenIntel.startCapture();
      } catch (e) {
        console.error("Live screen intel failed, falling back to basic", e);
        setScreenMode("basic");
        await screenShare.startSharing();
      }
    } else if (mode === "basic") {
      await screenShare.startSharing();
    }

    if (user && orchestrator) {
      setIsLoading(true);
      try {
        const ctx = { phase: "teaching" as ConversationPhase, messages, user, mistakes: getMistakes(), quests: getQuests(), progressNotes: getProgressNotes(), mood: "normal" as MoodType, sessionStart: Date.now(), isScreenSharing: mode !== "off" };
        const r = await orchestrator.generateResponse(ctx, `i'm ready to learn ${user.tool}. ${mode !== "off" ? "you can see my screen." : ""} where do we begin?`);
        addMessage({ id: uid(), role: "ai", content: r, timestamp: Date.now(), phase: "teaching" });
      } catch {} finally { setIsLoading(false); }
    }
  }, [user, orchestrator, messages, addMessage, screenShare, screenIntel]);

  const handleVoiceToggle = useCallback(() => {
    if (voice.isListening) {
      voice.stopListening();
      if (voice.transcript) { handleSend(voice.transcript, true); voice.clearTranscript(); }
    } else { voice.stopSpeaking(); voice.startListening(); }
  }, [voice, handleSend]);

  const handleReset = useCallback(() => {
    clearAllData(); setUser(null); setMessages([]); setStep("greeting");
    greeted.current = false; setOnboarded(false); screenIntel.stop();
  }, [screenIntel]);

  if (!mounted) return null;

  const isSharing = screenMode === "live" ? screenIntel.isCapturing : screenShare.isSharing;

  return (
    <div className="h-screen flex flex-col bg-kira-bg overflow-hidden">
      {/* HEADER */}
      <header className="flex-shrink-0 flex items-center justify-between px-3 sm:px-5 h-12 border-b border-kira-border/50 glass">
        <button onClick={() => setShowSidebar(!showSidebar)} className="flex items-center gap-2 text-kira-textMuted hover:text-kira-text transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          <span className="text-sm font-medium">kira</span>
          {user && <span className="text-[10px] text-kira-textMuted/40 hidden sm:inline">· {user.tool}</span>}
          {screenMode === "live" && <span className="text-[10px] text-kira-green/60 hidden sm:inline">· live vision</span>}
        </button>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setAutoSpeak(!autoSpeak)} className={`p-1.5 rounded-lg ${autoSpeak ? "bg-kira-accent/20 text-kira-accent" : "text-kira-textMuted/30 hover:text-kira-textMuted"}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {autoSpeak ? <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></> :
              <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><line x1="1" y1="1" x2="23" y2="23" /></>}
            </svg>
          </button>
          <button onClick={() => screenShare.isSharing ? screenShare.stopSharing() : screenShare.startSharing()} className={`p-1.5 rounded-lg ${screenShare.isSharing ? "bg-kira-accent/20 text-kira-accent" : "text-kira-textMuted/40 hover:text-kira-textMuted"}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
          </button>
          <button onClick={handleVoiceToggle} className={`p-1.5 rounded-lg ${voice.isListening ? "bg-kira-accent/20 text-kira-accent pulse-ring relative" : voice.isSpeaking ? "bg-kira-green/10 text-kira-green" : "text-kira-textMuted/40 hover:text-kira-textMuted"}`}>
            {voice.isListening ? <div className="flex gap-0.5"><div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" /><div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0.15s" }} /><div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0.3s" }} /></div> :
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>}
          </button>
        </div>
      </header>

      {/* MAIN */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {showSidebar && <Sidebar user={user} isScreenSharing={isSharing} onShowMistakes={() => { setShowMistakes(true); setShowSidebar(false); }} onShowQuest={() => { setShowQuest(true); setShowSidebar(false); }} onReset={handleReset} onClose={() => setShowSidebar(false)} />}

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            <div className="max-w-2xl mx-auto space-y-4">
              {messages.map(m => <div key={m.id} className="message-enter"><MsgBubble msg={m} /></div>)}
              {isLoading && (
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-kira-accent/20 flex items-center justify-center flex-shrink-0"><span className="text-xs">✦</span></div>
                  <div className="bg-kira-surface border border-kira-border/50 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-kira-accent/60 typing-dot" /><div className="w-1.5 h-1.5 rounded-full bg-kira-accent/60 typing-dot" /><div className="w-1.5 h-1.5 rounded-full bg-kira-accent/60 typing-dot" /></div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {step === "personality-pick" && <PersonalityPicker onSelect={handlePersonality} selected={user?.personality || null} />}

          {/* Screen permission with 3 options */}
          {step === "screen-permission" && (
            <div className="border-t border-kira-border/50 bg-kira-surface/50 p-5 animate-fade-up">
              <div className="max-w-2xl mx-auto">
                <p className="text-sm text-kira-textMuted mb-4 text-center">how should i see your screen?</p>
                <div className="grid grid-cols-3 gap-3">
                  <button onClick={() => handleScreenPerm("live")} className="p-4 bg-kira-surface border border-kira-accent/30 rounded-xl text-center hover:border-kira-accent transition-colors">
                    <div className="text-2xl mb-2">👁️</div>
                    <p className="text-sm font-medium text-kira-accent">live vision</p>
                    <p className="text-[10px] text-kira-textMuted mt-1">i watch in real-time. i see what you see. like manus.</p>
                  </button>
                  <button onClick={() => handleScreenPerm("basic")} className="p-4 bg-kira-surface border border-kira-border rounded-xl text-center hover:border-kira-accent/50 transition-colors">
                    <div className="text-2xl mb-2">📸</div>
                    <p className="text-sm font-medium text-kira-text">periodic</p>
                    <p className="text-[10px] text-kira-textMuted mt-1">i take a snapshot when you ask. private. simple.</p>
                  </button>
                  <button onClick={() => handleScreenPerm("off")} className="p-4 bg-kira-surface border border-kira-border rounded-xl text-center hover:border-kira-accent/50 transition-colors">
                    <div className="text-2xl mb-2">💬</div>
                    <p className="text-sm font-medium text-kira-text">just chat</p>
                    <p className="text-[10px] text-kira-textMuted mt-1">no screen. we just talk. always works.</p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* INPUT */}
          <div className="flex-shrink-0 border-t border-kira-border/50 p-3 glass">
            <form onSubmit={e => { e.preventDefault(); if (inputText.trim()) handleSend(inputText.trim()); }} className="flex items-center gap-2.5 max-w-2xl mx-auto">
              {voice.isSpeaking && <button type="button" onClick={voice.stopSpeaking} className="p-2 rounded-lg bg-kira-red/10 text-kira-red flex-shrink-0"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg></button>}
              <input type="text" value={voice.isListening ? (voice.transcript || "listening...") : inputText} onChange={e => { if (!voice.isListening) setInputText(e.target.value); }} placeholder={voice.isListening ? "speak..." : step === "greeting" ? "what are you trying to figure out?" : "type..."} disabled={isLoading} maxLength={2000}
                className={`flex-1 bg-kira-surface border border-kira-border rounded-xl px-3.5 py-2.5 text-sm text-kira-text placeholder:text-kira-textMuted/40 focus:outline-none focus:border-kira-accent/40 ${voice.isListening ? "border-kira-accent/40" : ""} ${isLoading ? "opacity-50" : ""}`} />
              <button type="submit" disabled={isLoading || (!inputText.trim() && !voice.isListening)} className="p-2.5 bg-kira-accent text-white rounded-xl hover:bg-kira-accentLight transition-all btn-glow flex-shrink-0 disabled:opacity-20">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </form>
          </div>
        </div>

        {/* Screen preview */}
        {(screenMode === "basic" && screenShare.isSharing) && <ScreenSharePanel videoRef={screenShare.videoRef} onStop={screenShare.stopSharing} onCapture={screenShare.captureFrame} />}
        {screenMode === "live" && (
          <div className="flex-shrink-0 w-64 border-l border-kira-border/50 bg-kira-surface/30 p-3 hidden lg:flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-kira-textMuted">live vision</span>
              <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-kira-green animate-pulse" /><span className="text-[10px] text-kira-green">active</span></div>
            </div>
            <div className="bg-kira-surface rounded-lg p-3 border border-kira-border/50 text-center">
              <p className="text-2xl mb-2">👁️</p>
              <p className="text-xs text-kira-text/60">gemini live is watching your screen. every {screenIntel.frameCount > 0 ? "second" : "second"}.</p>
              <p className="text-[10px] text-kira-accent mt-2">{screenIntel.frameCount} frames analyzed</p>
            </div>
            <button onClick={() => { screenIntel.stop(); setScreenMode("off"); }} className="w-full py-2 px-3 bg-kira-surface border border-kira-border text-kira-textMuted text-xs rounded-lg hover:text-kira-text transition-colors">stop live vision</button>
          </div>
        )}
      </div>

      {showMistakes && <MistakeBank onClose={() => setShowMistakes(false)} />}
      {showQuest && <DailyQuest onClose={() => setShowQuest(false)} />}
    </div>
  );
}

function MsgBubble({ msg }: { msg: Message }) {
  const isAI = msg.role === "ai";
  return (
    <div className={`flex items-start gap-2.5 ${isAI ? "" : "flex-row-reverse"}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${isAI ? "bg-kira-accent/20 text-kira-accent" : "bg-kira-green/15 text-kira-green"}`}>{isAI ? "✦" : "u"}</div>
      <div className={`max-w-[80%] sm:max-w-[75%] ${isAI ? "bg-kira-surface border border-kira-border/40 rounded-2xl rounded-tl-sm" : "bg-kira-accent/8 border border-kira-accent/15 rounded-2xl rounded-tr-sm"} px-3.5 py-2.5`}>
        <div className="text-[14px] leading-relaxed whitespace-pre-wrap text-kira-text/90">{msg.content}</div>
        <div className="flex items-center gap-2 mt-1.5">
          {msg.isVoice && <span className="text-[9px] text-kira-textMuted/25">🎤</span>}
          <span className="text-[9px] text-kira-textMuted/20 ml-auto">{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
    </div>
  );
}
