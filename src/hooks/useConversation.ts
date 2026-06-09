"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Message,
  ConversationPhase,
  ConversationContext,
  MoodType,
  UserProfile,
  Mistake,
  ProgressNote,
  Quest,
  MessageRole,
  ScreenContext,
} from "@/lib/types";
import {
  getSessionMessages,
  setSessionMessages,
  addMessage as addMessageToStorage,
  getUserProfile,
  getMistakes,
  getProgressNotes,
  getQuests,
  addProgressNote as addProgressNoteToStorage,
  addMistake as addMistakeToStorage,
} from "@/lib/storage";
import { AIOrchestrator } from "@/lib/ai/orchestrator";

// Simple UUID generator
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function useConversation(apiKey: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState<ConversationPhase>("greeting");
  const [mood, setMood] = useState<MoodType>("normal");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenContext, setScreenContext] = useState<ScreenContext | undefined>();
  const [orchestrator] = useState(() => new AIOrchestrator(apiKey));
  const sessionStartRef = useRef(Date.now());
  const responseTimeRef = useRef<number[]>([]);

  // Load previous session on mount
  useEffect(() => {
    const stored = getSessionMessages();
    if (stored.length > 0) {
      setMessages(stored);
      // Determine phase from last messages
      const lastAiMsg = stored.filter((m) => m.role === "ai").pop();
      if (lastAiMsg?.phase) {
        setPhase(lastAiMsg.phase);
      }
    }
  }, []);

  // Detect mood from response patterns
  const detectMood = useCallback(
    (userMessage: string): MoodType => {
      const recentTimes = responseTimeRef.current;
      const avgTime =
        recentTimes.length > 0
          ? recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length
          : 0;

      // Slow responses + confusion words = slow mood
      const confusionWords = [
        "confused",
        "don't understand",
        "lost",
        "what",
        "huh",
        "wait",
      ];
      const hasConfusion = confusionWords.some((w) =>
        userMessage.toLowerCase().includes(w)
      );

      if (hasConfusion) return "slow";
      if (avgTime > 30000) return "tired"; // Taking 30+ seconds to respond
      if (avgTime < 5000 && !hasConfusion) return "in-the-zone";

      return "normal";
    },
    []
  );

  // Track response time
  const lastUserMessageTime = useRef(Date.now());

  const sendMessage = useCallback(
    async (
      content: string,
      isVoice: boolean = false,
      screenData?: string
    ) => {
      if (!content.trim() || isLoading) return;

      const now = Date.now();
      const responseTime = now - lastUserMessageTime.current;
      responseTimeRef.current.push(responseTime);
      if (responseTimeRef.current.length > 10) {
        responseTimeRef.current.shift();
      }
      lastUserMessageTime.current = now;

      const detectedMood = detectMood(content);
      setMood(detectedMood);

      // Create user message
      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content,
        timestamp: now,
        phase,
        isVoice,
        screenContext: screenData
          ? { imageData: screenData, timestamp: now }
          : undefined,
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      addMessageToStorage(userMessage);
      setIsLoading(true);

      try {
        const user = getUserProfile();
        if (!user) return;

        const context: ConversationContext = {
          phase,
          messages: updatedMessages,
          user,
          mistakes: getMistakes(),
          quests: getQuests(),
          progressNotes: getProgressNotes(),
          screenContext: screenData
            ? { imageData: screenData, timestamp: now }
            : undefined,
          mood: detectedMood,
          sessionStart: sessionStartRef.current,
          isScreenSharing,
        };

        const response = await orchestrator.generateResponse(
          context,
          content,
          screenData
        );

        // Detect phase transitions from response content
        let newPhase = phase;
        if (
          response.toLowerCase().includes("let me ask you") ||
          response.toLowerCase().includes("paint me the picture")
        ) {
          newPhase = "goal-discovery";
        } else if (
          response.toLowerCase().includes("explain to me in your own words")
        ) {
          newPhase = "testing";
        } else if (
          response.toLowerCase().includes("today's quest") ||
          response.toLowerCase().includes("tiny thing")
        ) {
          newPhase = "quest";
        } else if (detectedMood === "slow" || detectedMood === "tired") {
          newPhase = "reflection";
        } else {
          newPhase = "teaching";
        }
        setPhase(newPhase);

        const aiMessage: Message = {
          id: generateId(),
          role: "ai",
          content: response,
          timestamp: Date.now(),
          phase: newPhase,
        };

        setMessages((prev) => [...prev, aiMessage]);
        addMessageToStorage(aiMessage);
      } catch (error) {
        console.error("Failed to send message:", error);
        const errorMessage: Message = {
          id: generateId(),
          role: "ai",
          content:
            "sorry, something went wrong on my end. can you try saying that again?",
          timestamp: Date.now(),
          phase,
        };
        setMessages((prev) => [...prev, errorMessage]);
        addMessageToStorage(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, phase, isScreenSharing, detectMood, orchestrator]
  );

  const clearConversation = useCallback(() => {
    setMessages([]);
    setPhase("greeting");
    sessionStartRef.current = Date.now();
    responseTimeRef.current = [];
  }, []);

  return {
    messages,
    isLoading,
    phase,
    mood,
    isScreenSharing,
    setIsScreenSharing,
    screenContext,
    setScreenContext,
    sendMessage,
    clearConversation,
    setPhase,
  };
}
