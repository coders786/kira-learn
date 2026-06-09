"use client";

import { useRef, useEffect, forwardRef } from "react";
import { Message, PersonalityType, UserProfile } from "@/lib/types";

interface ConversationProps {
  messages: Message[];
  isLoading: boolean;
  user: UserProfile | null;
  personality: PersonalityType;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export default function Conversation({
  messages,
  isLoading,
  user,
  personality,
  messagesEndRef,
}: ConversationProps) {
  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            personality={personality}
            isLatest={index === messages.length - 1}
          />
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex items-start gap-3 message-enter">
            <div className="w-8 h-8 rounded-full bg-kira-accent/20 flex items-center justify-center flex-shrink-0">
              <span className="text-sm">✦</span>
            </div>
            <div className="bg-kira-surface border border-kira-border/50 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-kira-accent typing-dot" />
                <div className="w-2 h-2 rounded-full bg-kira-accent typing-dot" />
                <div className="w-2 h-2 rounded-full bg-kira-accent typing-dot" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

// ===== Message Bubble =====
function MessageBubble({
  message,
  personality,
  isLatest,
}: {
  message: Message;
  personality: PersonalityType;
  isLatest: boolean;
}) {
  const isAI = message.role === "ai";
  const isSystem = message.role === "system";

  if (isSystem) return null;

  return (
    <div
      className={`flex items-start gap-3 ${
        isLatest ? "message-enter" : ""
      } ${isAI ? "" : "flex-row-reverse"}`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${
          isAI
            ? "bg-kira-accent/20 text-kira-accent"
            : "bg-kira-green/20 text-kira-green"
        }`}
      >
        {isAI ? "✦" : "you"}
      </div>

      {/* Message content */}
      <div
        className={`max-w-[80%] sm:max-w-[70%] ${
          isAI
            ? "bg-kira-surface border border-kira-border/50 rounded-2xl rounded-tl-sm"
            : "bg-kira-accent/10 border border-kira-accent/20 rounded-2xl rounded-tr-sm"
        } px-4 py-3`}
      >
        <div className="ai-message-content text-[15px] leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>

        {/* Voice indicator */}
        {message.isVoice && (
          <div className="mt-1.5 text-xs text-kira-textMuted/40 flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
            voice
          </div>
        )}

        {/* Timestamp */}
        <div className="mt-1.5 text-[11px] text-kira-textMuted/30">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
