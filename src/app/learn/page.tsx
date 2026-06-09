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
import { ScreenEngine, ScreenAnalysis } from "@/lib/screen/screen-engine";
import { TriggerEngine, TriggerResult, TriggerContext } from "@/lib/ai/trigger-engine";
import { useVoice } from "@/hooks/useVoice";
import PersonalityPicker from "@/components/app/PersonalityPicker";
import MistakeBank from "@/components/app/MistakeBank";
import DailyQuest from "@/components/app/DailyQuest";
import Sidebar from "@/components/app/Sidebar";

function uid(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

type Step = "greeting" | "goal-discovery" | "personality-pick" | "screen-permission" | "teaching";
type ScreenMode = "off" | "periodic" | "live";

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
  const [alwaysOnMic, setAlwaysOnMic] = useState(false);
  const [screenMode, setScreenMode] = useState<ScreenMode>("off");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenFrameCount, setScreenFrameCount] = useState(0);
  const [lastScreenInfo, setLastScreenInfo] = useState<{ app: string; page: string } | null>(null);
  const [orchestrator, setOrchestrator] = useState<AIOrchestrator | null>(null);

  // ===== REFS for stable engine instances =====
  const screenEngineRef = useRef<ScreenEngine | null>(null);
  const triggerEngineRef = useRef<TriggerEngine>(new TriggerEngine());
  const endRef = useRef<HTMLDivElement>(null);
  const greeted = useRef(false);
  const sending = useRef(false);
  const lastUserMsgTime = useRef(Date.now());
  const lastAIMsgTime = useRef(Date.now());
  const lastProactiveTime = useRef(0);

  // ===== MUTABLE REFS to avoid stale closures =====
  const messagesRef = useRef<Message[]>([]);
  const isLoadingRef = useRef(false);
  const inputTextRef = useRef("");
  const stepRef = useRef<Step>("greeting");
  const userRef = useRef<UserProfile | null>(null);
  const isScreenSharingRef = useRef(false);
  const screenModeRef = useRef<ScreenMode>("off");
  const orchestratorRef = useRef<AIOrchestrator | null>(null);

  // Sync refs with state
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { inputTextRef.current = inputText; }, [inputText]);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
  useEffect(() => { screenModeRef.current = screenMode; }, [screenMode]);
  useEffect(() => { orchestratorRef.current = orchestrator; }, [orchestrator]);

  // ===== Voice hook with auto-send =====
  const voice = useVoice({
    onAutoSend: (text: string) => {
      if (text.trim() && !sending.current && !isLoadingRef.current) {
        handleSendRef.current(text.trim(), true);
      }
    },
  });

  // ===== STABLE handleSend via ref (avoids stale closures) =====
  const handleSendRef = useRef<(content: string, isVoice?: boolean) => void>(() => {});

  // ===== Init =====
  useEffect(() => {
    if (mounted) return;
    setMounted(true);
    const key = getGeminiKey();
    if (!key) { router.push("/"); return; }
    try {
      const orch = new AIOrchestrator(key);
      setOrchestrator(orch);
      orchestratorRef.current = orch;

      // Init screen engine
      screenEngineRef.current = new ScreenEngine(key);

      // Init Gemini STT
      voice.initGeminiSTT(key);
    } catch { router.push("/"); return; }

    const u = getUserProfile();
    if (u && isOnboarded()) {
      setUser(u);
      userRef.current = u;
      setStep("teaching");
      stepRef.current = "teaching";
      const prev = getSessionMessages();
      if (prev.length) setMessages(prev);
    }
  }, [mounted, router]);

  // ===== Greeting =====
  useEffect(() => {
    if (!mounted || !orchestrator || user || greeted.current || messages.length) return;
    greeted.current = true;
    const g: Message = {
      id: uid(), role: "ai",
      content: "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier.",
      timestamp: Date.now(), phase: "greeting",
    };
    setMessages([g]);
    setSessionMessages([g]);
    lastAIMsgTime.current = Date.now();
  }, [mounted, orchestrator, user, messages.length]);

  // ===== Scroll =====
  useEffect(() => {
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [messages, isLoading]);

  // ===== Auto-speak AI responses =====
  useEffect(() => {
    if (!autoSpeak || !messages.length) return;
    const last = messages[messages.length - 1];
    if (last.role === "ai" && Date.now() - last.timestamp < 3000 && !voice.isSpeaking) {
      voice.speak(last.content, user?.personality || "chill");
    }
  }, [messages.length, autoSpeak]);

  // ===== Always-on mic =====
  useEffect(() => {
    if (alwaysOnMic && step === "teaching" && voice.supported && !voice.isListening) {
      voice.startListening();
    }
  }, [alwaysOnMic, step, voice.supported]);

  // ===== Update voice context with recent messages =====
  useEffect(() => {
    if (messages.length > 0) {
      const recent = messages.slice(-6).map(m =>
        `${m.role === "ai" ? "Kira" : "Student"}: ${m.content.substring(0, 80)}`
      ).join(". ");
      voice.updateContext(recent);
    }
  }, [messages.length]);

  // ===== Update screen engine context =====
  useEffect(() => {
    if (screenEngineRef.current && messages.length > 0) {
      const recent = messages.slice(-6).map(m =>
        `${m.role === "ai" ? "Kira" : "Student"}: ${m.content.substring(0, 100)}`
      ).join("\n");
      screenEngineRef.current.setRecentMessages(recent);
    }
  }, [messages.length]);

  // ===== Add message helper =====
  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      const u = [...prev, msg];
      setSessionMessages(u);
      return u;
    });
    addMsg(msg);
  }, []);

  // ===== STABLE screen analysis callback (uses refs, not state) =====
  const handleScreenAnalysisRef = useRef<(analysis: ScreenAnalysis, frame: string) => void>(() => {});

  // Update the stable callback implementation whenever dependencies change
  useEffect(() => {
    handleScreenAnalysisRef.current = (analysis: ScreenAnalysis, frame: string) => {
      setScreenFrameCount(prev => prev + 1);
      setLastScreenInfo({ app: analysis.app, page: analysis.page });

      // High urgency → trigger immediately
      if (analysis.shouldComment && analysis.urgency === "high") {
        const now = Date.now();
        if (now - lastProactiveTime.current > 5000) {
          lastProactiveTime.current = now;
          triggerEngineRef.current.markTriggered("screen-error");
          addMessage({
            id: uid(), role: "ai", content: analysis.comment,
            timestamp: Date.now(), phase: "teaching",
          });
          lastAIMsgTime.current = Date.now();
        }
      }
    };
  }, [addMessage]);

  // Keep screen engine callbacks updated (avoids stale closures)
  useEffect(() => {
    if (screenEngineRef.current && isScreenSharing) {
      screenEngineRef.current.setCallbacks(
        (analysis, frame) => handleScreenAnalysisRef.current(analysis, frame),
        () => { setIsScreenSharing(false); }
      );
    }
  }, [isScreenSharing, messages.length, isLoading, step]);

  // ===== Detect mood =====
  function detectMood(content: string): MoodType {
    const lower = content.toLowerCase();
    if (/\b(tired|brain dead|overwhelmed|exhausted)\b/.test(lower)) return "tired";
    if (/\b(confused|don't understand|lost|what\?|huh)\b/.test(lower)) return "slow";
    return "normal";
  }

  // ===== HANDLE SEND (stable via ref) =====
  const handleSend = useCallback(async (content: string, isVoice = false) => {
    if (!content.trim() || isLoadingRef.current || !orchestratorRef.current || sending.current) return;
    sending.current = true;
    const orch = orchestratorRef.current;
    const currentUser = userRef.current;
    const currentStep = stepRef.current;
    const currentMessages = messagesRef.current;
    const sharing = isScreenSharingRef.current;

    const sanitized = orch.sanitizeInput(content);
    const special = orch.getSpecialResponse(sanitized);

    if (special) {
      addMessage({
        id: uid(), role: "user", content: sanitized.clean || content.trim(),
        timestamp: Date.now(), phase: currentStep as ConversationPhase, isVoice,
      });
      addMessage({
        id: uid(), role: "ai", content: special,
        timestamp: Date.now(), phase: currentStep as ConversationPhase,
      });
      lastUserMsgTime.current = Date.now();
      lastAIMsgTime.current = Date.now();
      sending.current = false;
      return;
    }

    const detectedMood = detectMood(sanitized.clean);
    setMood(detectedMood);
    setInputText("");
    inputTextRef.current = "";

    addMessage({
      id: uid(), role: "user", content: sanitized.clean,
      timestamp: Date.now(),
      phase: currentStep === "teaching" ? "teaching" : "goal-discovery",
      isVoice,
    });
    lastUserMsgTime.current = Date.now();

    triggerEngineRef.current.recordUserMessage(sanitized.clean);
    setIsLoading(true);
    isLoadingRef.current = true;

    try {
      if (currentStep === "greeting" || currentStep === "goal-discovery") {
        const result = await orch.discoverGoal(currentMessages);
        addMessage({
          id: uid(), role: "ai", content: result.response,
          timestamp: Date.now(), phase: "goal-discovery",
        });
        lastAIMsgTime.current = Date.now();

        if (result.extractedGoal && result.extractedRealGoal) {
          const profile: UserProfile = {
            id: uid(), goal: result.extractedGoal, realGoal: result.extractedRealGoal,
            tool: result.extractedGoal.replace(/^(i want to learn |teach me |show me )/i, "").trim() || result.extractedGoal,
            personality: "chill",
            learningPreferences: { pace: "normal", hatesWords: ["synergy"], maxOptions: 2 },
            createdAt: Date.now(), lastSessionAt: Date.now(), totalSessions: 1, streakDays: 1,
          };
          setUser(profile);
          userRef.current = profile;
          setUserProfile(profile);
          setStep("personality-pick");
          stepRef.current = "personality-pick";
        }
      } else if (currentStep === "teaching" && currentUser) {
        const screenData = sharing
          ? screenEngineRef.current?.getCurrentFrame() || undefined
          : undefined;

        const ctx = {
          phase: "teaching" as ConversationPhase, messages: currentMessages, user: currentUser,
          mistakes: getMistakes(), quests: getQuests(),
          progressNotes: getProgressNotes(),
          screenContext: screenData ? { imageData: screenData, timestamp: Date.now() } : undefined,
          mood: detectedMood, sessionStart: Date.now(), isScreenSharing: sharing,
        };

        const response = await orch.generateResponse(ctx, sanitized.clean, screenData);
        addMessage({
          id: uid(), role: "ai", content: response,
          timestamp: Date.now(), phase: "teaching",
        });
        lastAIMsgTime.current = Date.now();
      }
    } catch (e) {
      console.error(e);
      addMessage({
        id: uid(), role: "ai", content: "something went wrong. try again?",
        timestamp: Date.now(), phase: currentStep as ConversationPhase,
      });
      lastAIMsgTime.current = Date.now();
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
      sending.current = false;
    }
  }, [addMessage]);

  // Keep handleSendRef updated
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  // ===== Personality pick =====
  const handlePersonality = useCallback((p: PersonalityType) => {
    const u = userRef.current;
    if (!u) return;
    const updated = { ...u, personality: p };
    setUser(updated);
    userRef.current = updated;
    setUserProfile(updated);
    setStep("screen-permission");
    stepRef.current = "screen-permission";
    const c = PERSONALITIES.find(x => x.id === p);
    addMessage({
      id: uid(), role: "ai",
      content: `okay. i'll be ${c?.name}. let's do this.\n\none thing — i can see your screen while we learn. you turn it off anytime. i don't save anything. just look, help, forget.\n\npick how you want screen sharing to work:`,
      timestamp: Date.now(), phase: "screen-permission",
    });
    lastAIMsgTime.current = Date.now();
  }, [addMessage]);

  // ===== Screen permission =====
  const handleScreenPerm = useCallback(async (mode: ScreenMode) => {
    setScreenMode(mode);
    screenModeRef.current = mode;
    setStep("teaching");
    stepRef.current = "teaching";
    setOnboarded(true);

    addMessage({
      id: uid(), role: "user",
      content: mode === "live" ? "live screen sharing" : mode === "periodic" ? "periodic screen sharing" : "no screen sharing",
      timestamp: Date.now(), phase: "screen-permission",
    });
    lastUserMsgTime.current = Date.now();

    const apiKey = getGeminiKey();
    const currentUser = userRef.current;

    if (mode !== "off" && currentUser && apiKey && screenEngineRef.current) {
      screenEngineRef.current.setTeachingContext(currentUser.tool, currentUser.realGoal, currentUser.personality);

      const success = await screenEngineRef.current.startCapture(
        mode === "live" ? "live" : "periodic",
        (analysis, frame) => handleScreenAnalysisRef.current(analysis, frame),
        () => { setIsScreenSharing(false); isScreenSharingRef.current = false; }
      );

      if (success) {
        setIsScreenSharing(true);
        isScreenSharingRef.current = true;
      } else {
        console.warn("[Learn] Screen capture failed, falling back to off");
        setScreenMode("off");
        screenModeRef.current = "off";
      }
    }

    // Welcome message
    if (currentUser && orchestratorRef.current) {
      setIsLoading(true);
      isLoadingRef.current = true;
      try {
        const ctx = {
          phase: "teaching" as ConversationPhase, messages: messagesRef.current, user: currentUser,
          mistakes: getMistakes(), quests: getQuests(),
          progressNotes: getProgressNotes(),
          mood: "normal" as MoodType, sessionStart: Date.now(),
          isScreenSharing: mode !== "off",
        };
        const r = await orchestratorRef.current.generateResponse(
          ctx,
          `i'm ready to learn ${currentUser.tool}. ${mode !== "off" ? "you can see my screen." : ""} where do we begin?`
        );
        addMessage({ id: uid(), role: "ai", content: r, timestamp: Date.now(), phase: "teaching" });
        lastAIMsgTime.current = Date.now();
      } catch {} finally {
        setIsLoading(false);
        isLoadingRef.current = false;
      }
    }
  }, [addMessage]);

  // ===== TRIGGER ENGINE — Main proactive loop =====
  useEffect(() => {
    if (step !== "teaching" || !orchestrator) return;

    const triggerLoop = setInterval(async () => {
      // Don't evaluate if busy
      if (isLoadingRef.current || sending.current || inputTextRef.current.trim()) return;

      const now = Date.now();
      const lastAnalysis = screenEngineRef.current?.lastScreenAnalysis;

      const ctx: TriggerContext = {
        now,
        lastUserMessageTime: lastUserMsgTime.current,
        lastAIMessageTime: lastAIMsgTime.current,
        sessionStartTime: messagesRef.current[0]?.timestamp || now,
        recentUserMessages: messagesRef.current.filter(m => m.role === "user").slice(-5).map(m => m.content),
        totalMessages: messagesRef.current.length,
        lastAIContent: messagesRef.current.filter(m => m.role === "ai").slice(-1)[0]?.content || "",
        screenSharing: isScreenSharingRef.current,
        screenMode: screenModeRef.current,
        lastScreenAnalysisTime: lastAnalysis ? now : 0,
        screenApp: lastAnalysis?.app || "",
        screenPage: lastAnalysis?.page || "",
        screenShouldComment: lastAnalysis?.shouldComment || false,
        screenComment: lastAnalysis?.comment || "",
        screenUrgency: lastAnalysis?.urgency || "low",
        isUserTyping: inputTextRef.current.trim().length > 0,
        isLoading: isLoadingRef.current,
        currentPhase: stepRef.current,
      };

      const result = triggerEngineRef.current.evaluate(ctx);

      if (result) {
        triggerEngineRef.current.markTriggered(result.type);
        lastProactiveTime.current = now;

        // If trigger provides immediate text, use it directly
        if (result.immediate) {
          addMessage({
            id: uid(), role: "ai", content: result.immediate,
            timestamp: Date.now(), phase: "teaching",
          });
          lastAIMsgTime.current = now;
          return;
        }

        // Otherwise generate via AI
        if (!orchestratorRef.current || !userRef.current || sending.current) return;

        sending.current = true;
        setIsLoading(true);
        isLoadingRef.current = true;

        try {
          const screenData = isScreenSharingRef.current
            ? screenEngineRef.current?.getCurrentFrame() || undefined
            : undefined;

          const cctx = {
            phase: "teaching" as ConversationPhase,
            messages: messagesRef.current,
            user: userRef.current,
            mistakes: getMistakes(), quests: getQuests(),
            progressNotes: getProgressNotes(),
            screenContext: screenData ? { imageData: screenData, timestamp: Date.now() } : undefined,
            mood, sessionStart: Date.now(),
            isScreenSharing: isScreenSharingRef.current,
          };

          const response = await orchestratorRef.current.generateProactiveResponse(cctx, result.prompt, screenData);
          if (response) {
            addMessage({
              id: uid(), role: "ai", content: response,
              timestamp: Date.now(), phase: "teaching",
            });
            lastAIMsgTime.current = Date.now();
          }
        } catch (e) {
          console.error("[Proactive] Failed:", e);
        } finally {
          setIsLoading(false);
          isLoadingRef.current = false;
          sending.current = false;
        }
      }
    }, 5000);

    return () => clearInterval(triggerLoop);
  }, [step, orchestrator, mood, addMessage]);

  // ===== Voice toggle =====
  const handleVoiceToggle = useCallback(() => {
    if (voice.isListening) {
      voice.stopListening();
    } else {
      voice.stopSpeaking();
      voice.startListening();
    }
  }, [voice]);

  // ===== Toggle always-on =====
  const toggleAlwaysOn = useCallback(() => {
    const next = !alwaysOnMic;
    setAlwaysOnMic(next);
    voice.enableAlwaysOn(next);
  }, [alwaysOnMic, voice]);

  // ===== Toggle screen share =====
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      screenEngineRef.current?.stop();
      setIsScreenSharing(false);
      isScreenSharingRef.current = false;
      setScreenMode("off");
      screenModeRef.current = "off";
    } else {
      const apiKey = getGeminiKey();
      const currentUser = userRef.current;
      if (!apiKey || !currentUser || !screenEngineRef.current) return;

      screenEngineRef.current.setTeachingContext(currentUser.tool, currentUser.realGoal, currentUser.personality);
      const success = await screenEngineRef.current.startCapture(
        "live",
        (analysis, frame) => handleScreenAnalysisRef.current(analysis, frame),
        () => { setIsScreenSharing(false); isScreenSharingRef.current = false; }
      );

      if (success) {
        setIsScreenSharing(true);
        isScreenSharingRef.current = true;
        setScreenMode("live");
        screenModeRef.current = "live";
      }
    }
  }, [isScreenSharing]);

  // ===== Reset =====
  const handleReset = useCallback(() => {
    clearAllData();
    setUser(null); userRef.current = null;
    setMessages([]);
    setStep("greeting"); stepRef.current = "greeting";
    greeted.current = false;
    setOnboarded(false);
    screenEngineRef.current?.stop();
    setIsScreenSharing(false); isScreenSharingRef.current = false;
    setScreenMode("off"); screenModeRef.current = "off";
    triggerEngineRef.current.reset();
    setAlwaysOnMic(false);
    voice.enableAlwaysOn(false);
  }, [voice]);

  // Cleanup
  useEffect(() => {
    return () => {
      screenEngineRef.current?.stop();
      triggerEngineRef.current.reset();
    };
  }, []);

  if (!mounted) return null;

  return (
    <div className="h-screen flex flex-col bg-kira-bg overflow-hidden">
      {/* HEADER */}
      <header className="flex-shrink-0 flex items-center justify-between px-3 sm:px-5 h-12 border-b border-kira-border/50 glass">
        <button onClick={() => setShowSidebar(!showSidebar)} className="flex items-center gap-2 text-kira-textMuted hover:text-kira-text transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          <span className="text-sm font-medium">kira</span>
          {user && <span className="text-[10px] text-kira-textMuted/40 hidden sm:inline">· {user.tool}</span>}
          {isScreenSharing && <span className="text-[10px] text-kira-green/60 hidden sm:inline">· {screenMode === "live" ? "live vision" : "screen"}</span>}
          {alwaysOnMic && <span className="text-[10px] text-kira-accent/60 hidden sm:inline">· mic on</span>}
        </button>
        <div className="flex items-center gap-1.5">
          {/* Auto-speak */}
          <button onClick={() => setAutoSpeak(!autoSpeak)} className={`p-1.5 rounded-lg ${autoSpeak ? "bg-kira-green/20 text-kira-green" : "text-kira-textMuted/30 hover:text-kira-textMuted"}`} title="Auto-speak AI responses">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {autoSpeak ? <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></> :
              <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><line x1="1" y1="1" x2="23" y2="23" /></>}
            </svg>
          </button>
          {/* Always-on mic */}
          <button onClick={toggleAlwaysOn} className={`p-1.5 rounded-lg ${alwaysOnMic ? "bg-kira-accent/20 text-kira-accent" : "text-kira-textMuted/40 hover:text-kira-textMuted"}`} title="Always-on mic (Gemini STT)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {alwaysOnMic ? <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><path d="M8 23h8" /></> :
              <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></>}
            </svg>
          </button>
          {/* Screen share */}
          <button onClick={toggleScreenShare} className={`p-1.5 rounded-lg ${isScreenSharing ? "bg-kira-accent/20 text-kira-accent" : "text-kira-textMuted/40 hover:text-kira-textMuted"}`} title="Toggle screen sharing">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
          </button>
          {/* Push-to-talk */}
          <button onClick={handleVoiceToggle} className={`p-1.5 rounded-lg ${voice.isListening ? "bg-kira-accent/20 text-kira-accent pulse-ring" : voice.isSpeaking ? "bg-kira-green/10 text-kira-green" : "text-kira-textMuted/40 hover:text-kira-textMuted"}`} title={voice.sttMode === "gemini" ? "Gemini STT" : "Browser STT"}>
            {voice.isListening ? (
              <div className="flex gap-0.5">
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" />
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0.15s" }} />
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0.3s" }} />
              </div>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
            )}
          </button>
          {/* Stop speaking */}
          {voice.isSpeaking && (
            <button onClick={voice.stopSpeaking} className="p-1.5 rounded-lg bg-kira-red/10 text-kira-red" title="Stop speaking">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>
          )}
        </div>
      </header>

      {/* MAIN */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {showSidebar && <Sidebar user={user} isScreenSharing={isScreenSharing} onShowMistakes={() => { setShowMistakes(true); setShowSidebar(false); }} onShowQuest={() => { setShowQuest(true); setShowSidebar(false); }} onReset={handleReset} onClose={() => setShowSidebar(false)} />}

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

          {step === "screen-permission" && (
            <div className="border-t border-kira-border/50 bg-kira-surface/50 p-5 animate-fade-up">
              <div className="max-w-2xl mx-auto">
                <p className="text-sm text-kira-textMuted mb-4 text-center">how should i see your screen?</p>
                <div className="grid grid-cols-3 gap-3">
                  <button onClick={() => handleScreenPerm("live")} className="p-4 bg-kira-surface border border-kira-accent/30 rounded-xl text-center hover:border-kira-accent transition-colors">
                    <div className="text-2xl mb-2">👁️</div>
                    <p className="text-sm font-medium text-kira-accent">live vision</p>
                    <p className="text-[10px] text-kira-textMuted mt-1">i watch in real-time. i see what you see. i notice mistakes before you make them.</p>
                  </button>
                  <button onClick={() => handleScreenPerm("periodic")} className="p-4 bg-kira-surface border border-kira-border rounded-xl text-center hover:border-kira-accent/50 transition-colors">
                    <div className="text-2xl mb-2">📸</div>
                    <p className="text-sm font-medium text-kira-text">periodic</p>
                    <p className="text-[10px] text-kira-textMuted mt-1">i see your screen when you send a message. private. simple.</p>
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
              <input
                type="text"
                value={voice.isListening ? (voice.transcript || (voice.isUserSpeaking ? "..." : "listening...")) : inputText}
                onChange={e => { if (!voice.isListening) setInputText(e.target.value); }}
                placeholder={voice.isListening ? "speak..." : alwaysOnMic ? "just talk... i'm listening" : step === "greeting" ? "what are you trying to figure out?" : "type..."}
                disabled={isLoading}
                maxLength={2000}
                className={`flex-1 bg-kira-surface border border-kira-border rounded-xl px-3.5 py-2.5 text-sm text-kira-text placeholder:text-kira-textMuted/40 focus:outline-none focus:border-kira-accent/40 ${voice.isListening ? "border-kira-accent/40" : ""} ${isLoading ? "opacity-50" : ""}`}
              />
              <button type="submit" disabled={isLoading || (!inputText.trim() && !voice.isListening)} className="p-2.5 bg-kira-accent text-white rounded-xl hover:bg-kira-accentLight transition-all btn-glow flex-shrink-0 disabled:opacity-20">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </form>
            <div className="flex items-center justify-center gap-3 mt-2">
              {isScreenSharing && (
                <span className="text-[10px] text-kira-green/50 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-kira-green inline-block" />
                  screen · {screenMode}{lastScreenInfo ? ` · ${lastScreenInfo.app}` : ""}{screenMode === "live" ? ` · ${screenFrameCount} frames` : ""}
                </span>
              )}
              {alwaysOnMic && (
                <span className="text-[10px] text-kira-accent/50 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-kira-accent inline-block animate-pulse" />
                  {voice.sttMode === "gemini" ? "gemini stt" : "browser stt"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Screen panel */}
        {isScreenSharing && screenMode === "live" && (
          <div className="flex-shrink-0 w-64 border-l border-kira-border/50 bg-kira-surface/30 p-3 hidden lg:flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-kira-textMuted">live vision</span>
              <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-kira-green animate-pulse" /><span className="text-[10px] text-kira-green">active</span></div>
            </div>
            <div className="bg-kira-surface rounded-lg p-3 border border-kira-border/50 text-center">
              <p className="text-2xl mb-2">👁️</p>
              <p className="text-xs text-kira-text/60">i'm watching your screen. i'll speak up when i notice something.</p>
              <p className="text-[10px] text-kira-accent mt-2">{screenFrameCount} frames analyzed</p>
            </div>
            {lastScreenInfo && (
              <div className="bg-kira-surface rounded-lg p-2 border border-kira-border/50">
                <p className="text-[10px] text-kira-textMuted uppercase tracking-wider mb-1">what i see</p>
                <p className="text-[11px] text-kira-text/70">{lastScreenInfo.app} · {lastScreenInfo.page}</p>
              </div>
            )}
            <div className="space-y-2">
              <button onClick={() => handleSend("what do you see on my screen right now?")} className="w-full py-2 px-3 bg-kira-accent/10 border border-kira-accent/30 text-kira-accent text-xs rounded-lg hover:bg-kira-accent/20 transition-colors">
                ask about screen
              </button>
              <button onClick={() => { screenEngineRef.current?.stop(); setIsScreenSharing(false); isScreenSharingRef.current = false; setScreenMode("off"); screenModeRef.current = "off"; }} className="w-full py-2 px-3 bg-kira-surface border border-kira-border text-kira-textMuted text-xs rounded-lg hover:text-kira-text transition-colors">
                stop sharing
              </button>
            </div>
            <p className="text-[10px] text-kira-textMuted/30 text-center mt-auto">screen data processed locally. never stored.</p>
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
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${isAI ? "bg-kira-accent/20 text-kira-accent" : "bg-kira-green/15 text-kira-green"}`}>
        {isAI ? "✦" : "u"}
      </div>
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
