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
  getSessionMessages,
} from "@/lib/storage";
import {
  PersonalityType,
  PERSONALITIES,
  UserProfile,
  ConversationPhase,
} from "@/lib/types";
import { useConversation } from "@/hooks/useConversation";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useVoice } from "@/hooks/useVoice";
import Conversation from "@/components/app/Conversation";
import PersonalityPicker from "@/components/app/PersonalityPicker";
import ScreenSharePanel from "@/components/app/ScreenSharePanel";
import MistakeBank from "@/components/app/MistakeBank";
import DailyQuest from "@/components/app/DailyQuest";
import Sidebar from "@/components/app/Sidebar";

// Simple UUID
function uid(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export default function LearnPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showPersonalityPicker, setShowPersonalityPicker] = useState(false);
  const [showScreenPermission, setShowScreenPermission] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showMistakeBank, setShowMistakeBank] = useState(false);
  const [showQuest, setShowQuest] = useState(false);

  const apiKey = getGeminiKey() || "";
  const {
    messages,
    isLoading,
    phase,
    mood,
    isScreenSharing,
    setIsScreenSharing,
    sendMessage,
    setPhase,
  } = useConversation(apiKey);

  const screenShare = useScreenShare();
  const voice = useVoice();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check API key on mount
  useEffect(() => {
    setMounted(true);
    if (!hasAPIKey()) {
      router.push("/");
      return;
    }

    const existingUser = getUserProfile();
    if (existingUser) {
      setUser(existingUser);
    }
  }, [router]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Handle onboarding flow
  useEffect(() => {
    if (!user && messages.length === 0 && !isLoading) {
      // First interaction - AI greets
      const greetingMsg = {
        id: uid(),
        role: "ai" as const,
        content:
          "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier.",
        timestamp: Date.now(),
        phase: "greeting" as ConversationPhase,
      };
      // We'll handle this in the conversation start
    }
  }, [user, messages.length, isLoading]);

  // Handle message sending with phase-aware logic
  const handleSendMessage = useCallback(
    async (content: string, isVoice: boolean = false) => {
      // If no user profile yet, we're in goal discovery
      if (!user) {
        // First message sets initial goal
        if (messages.length <= 1) {
          // User's first response - they said what they want to learn
          await sendMessage(content, isVoice);
          // After AI responds, check if we should show goal confirmation
        } else {
          await sendMessage(content, isVoice);
          // Check if goal has been extracted (from the conversation)
          // The orchestrator handles this
        }

        // Try to create user profile from conversation
        if (messages.length >= 2) {
          const lastAiMsg = messages.filter((m) => m.role === "ai").pop();
          if (
            lastAiMsg?.content.toLowerCase().includes("real goal") ||
            lastAiMsg?.content.toLowerCase().includes("cool?") ||
            lastAiMsg?.content.toLowerCase().includes("we're gonna keep that in mind")
          ) {
            // Goal likely discovered - extract what we can
            const userMessages = messages.filter((m) => m.role === "user");
            const firstUserMsg = userMessages[0]?.content || content;

            // Simple extraction: use the content as both goal and real goal initially
            const profile: UserProfile = {
              id: uid(),
              goal: firstUserMsg,
              realGoal: content.includes(" ") ? content : firstUserMsg,
              tool: firstUserMsg.replace(/i want to learn /i, "").trim(),
              personality: "chill", // Default, will be updated
              learningPreferences: {
                pace: "normal",
                hatesWords: ["synergy", "leverage"],
                maxOptions: 2,
              },
              createdAt: Date.now(),
              lastSessionAt: Date.now(),
              totalSessions: 1,
              streakDays: 1,
            };
            setUser(profile);
            setUserProfile(profile);
            setShowPersonalityPicker(true);
            setPhase("personality-pick");
          }
        }
        return;
      }

      // Normal teaching conversation
      const screenData = isScreenSharing ? screenShare.captureFrame() || undefined : undefined;
      await sendMessage(content, isVoice, screenData || undefined);
    },
    [user, messages, sendMessage, isScreenSharing, screenShare, setPhase]
  );

  // Handle personality selection
  const handlePersonalitySelect = useCallback(
    (personality: PersonalityType) => {
      if (!user) return;

      const updated = { ...user, personality };
      setUser(updated);
      setUserProfile(updated);
      setShowPersonalityPicker(false);
      setPhase("screen-permission");
      setOnboarded(true);

      // Add system message about personality
      const config = PERSONALITIES.find((p) => p.id === personality);
      const personalityMsg = {
        id: uid(),
        role: "ai" as const,
        content: `okay. i'll be ${config?.name}. let's do this.\n\none thing. to actually help you, i need to see your screen. just while we're learning. you can turn it off anytime. i don't save your screen. i just look at it, help you, and forget it. cool? want to try?`,
        timestamp: Date.now(),
        phase: "screen-permission" as ConversationPhase,
      };
    },
    [user, setPhase]
  );

  // Handle screen share permission
  const handleScreenPermission = useCallback(
    async (accepted: boolean) => {
      setShowScreenPermission(false);
      if (accepted) {
        const started = await screenShare.startSharing();
        if (started) {
          setIsScreenSharing(true);
        }
      }
      setPhase("teaching");

      // Send a message to start the session
      const screenMsg = accepted
        ? "yes, i'll share my screen"
        : "not right now, let's just talk";
      await sendMessage(screenMsg, false);
    },
    [screenShare, setIsScreenSharing, setPhase, sendMessage]
  );

  // Handle voice input
  const handleVoiceInput = useCallback(() => {
    if (voice.isListening) {
      voice.stopListening();
      if (voice.transcript) {
        handleSendMessage(voice.transcript, true);
        voice.clearTranscript();
      }
    } else {
      voice.startListening();
    }
  }, [voice, handleSendMessage]);

  // Speak AI messages automatically
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "ai" && !voice.isSpeaking) {
      voice.speak(lastMsg.content, user?.personality || "chill");
    }
  }, [messages.length]);

  if (!mounted) return null;

  return (
    <div className="h-screen flex flex-col bg-kira-bg overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 h-14 border-b border-kira-border/50">
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="flex items-center gap-2 text-kira-textMuted hover:text-kira-text transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
          <span className="text-sm font-medium">kira</span>
        </button>

        <div className="flex items-center gap-3">
          {/* Mood indicator */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                mood === "in-the-zone"
                  ? "bg-kira-green"
                  : mood === "tired"
                  ? "bg-kira-yellow"
                  : mood === "slow"
                  ? "bg-kira-blue"
                  : "bg-kira-textMuted"
              }`}
            />
            <span className="text-xs text-kira-textMuted hidden sm:inline">
              {phase === "teaching" ? "learning" : phase.replace("-", " ")}
            </span>
          </div>

          {/* Screen share toggle */}
          <button
            onClick={() => {
              if (isScreenSharing) {
                screenShare.stopSharing();
                setIsScreenSharing(false);
              } else {
                screenShare.startSharing().then((ok) => {
                  if (ok) setIsScreenSharing(true);
                });
              }
            }}
            className={`p-2 rounded-lg transition-colors ${
              isScreenSharing
                ? "bg-kira-accent/20 text-kira-accent"
                : "text-kira-textMuted hover:text-kira-text hover:bg-kira-surfaceLight"
            }`}
            title={isScreenSharing ? "Stop sharing" : "Share screen"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>

          {/* Voice toggle */}
          <button
            onClick={handleVoiceInput}
            className={`p-2 rounded-lg transition-colors ${
              voice.isListening
                ? "bg-kira-accent/20 text-kira-accent"
                : voice.isSpeaking
                ? "bg-kira-green/20 text-kira-green"
                : "text-kira-textMuted hover:text-kira-text hover:bg-kira-surfaceLight"
            }`}
            title={voice.isListening ? "Stop listening" : "Start voice input"}
          >
            {voice.isListening ? (
              <div className="flex items-center gap-0.5">
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0s" }} />
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0.2s" }} />
                <div className="w-0.5 h-3 bg-kira-accent voice-wave-bar" style={{ animationDelay: "0.4s" }} />
              </div>
            ) : voice.isSpeaking ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" fill="none" />
                <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {showSidebar && (
          <Sidebar
            user={user}
            isScreenSharing={isScreenSharing}
            onShowMistakes={() => setShowMistakeBank(true)}
            onShowQuest={() => setShowQuest(true)}
            onClose={() => setShowSidebar(false)}
          />
        )}

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <Conversation
            messages={messages}
            isLoading={isLoading}
            user={user}
            personality={user?.personality || "chill"}
            messagesEndRef={messagesEndRef}
          />

          {/* Inline panels */}
          {showPersonalityPicker && (
            <PersonalityPicker
              onSelect={handlePersonalitySelect}
              selected={null}
            />
          )}

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-kira-border/50 p-4">
            <InputArea
              onSend={handleSendMessage}
              isLoading={isLoading}
              isListening={voice.isListening}
              transcript={voice.transcript}
              onVoiceToggle={handleVoiceInput}
              isSpeaking={voice.isSpeaking}
              onStopSpeaking={voice.stopSpeaking}
            />
          </div>
        </div>

        {/* Screen share preview (right side) */}
        {isScreenSharing && (
          <ScreenSharePanel
            videoRef={screenShare.videoRef}
            onStop={() => {
              screenShare.stopSharing();
              setIsScreenSharing(false);
            }}
            onCapture={screenShare.captureFrame}
          />
        )}
      </div>

      {/* Overlay panels */}
      {showMistakeBank && (
        <MistakeBank onClose={() => setShowMistakeBank(false)} />
      )}
      {showQuest && <DailyQuest onClose={() => setShowQuest(false)} />}
    </div>
  );
}

// ===== Input Area Component =====
function InputArea({
  onSend,
  isLoading,
  isListening,
  transcript,
  onVoiceToggle,
  isSpeaking,
  onStopSpeaking,
}: {
  onSend: (msg: string, voice?: boolean) => void;
  isLoading: boolean;
  isListening: boolean;
  transcript: string;
  onVoiceToggle: () => void;
  isSpeaking: boolean;
  onStopSpeaking: () => void;
}) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSend(input.trim());
      setInput("");
    }
  };

  // If voice is listening, show transcript as input
  const displayValue = isListening ? transcript || "listening..." : input;
  const isDisabled = isLoading;

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3 max-w-3xl mx-auto w-full">
      {isSpeaking && (
        <button
          type="button"
          onClick={onStopSpeaking}
          className="p-2 rounded-lg bg-kira-red/20 text-kira-red hover:bg-kira-red/30 transition-colors flex-shrink-0"
          title="Stop speaking"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      )}

      <div className="flex-1 relative">
        <input
          type="text"
          value={isListening ? transcript : input}
          onChange={(e) => {
            if (!isListening) setInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              handleSubmit(e);
            }
          }}
          placeholder={isListening ? "speak now..." : "type your response..."}
          disabled={isDisabled}
          className={`w-full bg-kira-surface border border-kira-border rounded-xl px-4 py-3 pr-12 text-kira-text placeholder:text-kira-textMuted/40 focus:outline-none focus:border-kira-accent/50 transition-all ${
            isListening ? "border-kira-accent animate-pulse-slow" : ""
          } ${isDisabled ? "opacity-50" : ""}`}
        />
      </div>

      {/* Voice button */}
      <button
        type="button"
        onClick={onVoiceToggle}
        disabled={isDisabled}
        className={`p-3 rounded-xl transition-all flex-shrink-0 ${
          isListening
            ? "bg-kira-accent text-white pulse-ring"
            : "bg-kira-surface border border-kira-border text-kira-textMuted hover:text-kira-text hover:border-kira-accent/50"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>

      {/* Send button */}
      <button
        type="submit"
        disabled={isDisabled || (!input.trim() && !isListening)}
        className="p-3 bg-kira-accent text-white rounded-xl hover:bg-kira-accentLight transition-all btn-glow flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  );
}
