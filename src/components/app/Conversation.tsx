"use client";

// Reusable Conversation component for embedding in other views
// Main conversation is now inline in learn/page.tsx

import { Message, PersonalityType } from "@/lib/types";

interface ConversationProps {
  messages: Message[];
  isLoading: boolean;
  personality: PersonalityType;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export default function Conversation({
  messages,
  isLoading,
  personality,
  messagesEndRef,
}: ConversationProps) {
  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-2xl mx-auto space-y-5">
        {messages.map((msg) => (
          <div key={msg.id} className="message-enter">
            <MessageBubble message={msg} personality={personality} />
          </div>
        ))}

        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-kira-accent/20 flex items-center justify-center flex-shrink-0">
              <span className="text-sm">✦</span>
            </div>
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
  );
}

function MessageBubble({ message, personality }: { message: Message; personality: string }) {
  const isAI = message.role === "ai";

  return (
    <div className={`flex items-start gap-3 ${isAI ? "" : "flex-row-reverse"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium ${
        isAI ? "bg-kira-accent/20 text-kira-accent" : "bg-kira-green/15 text-kira-green"
      }`}>
        {isAI ? "✦" : "you"}
      </div>

      <div className={`max-w-[80%] sm:max-w-[75%] ${
        isAI
          ? "bg-kira-surface border border-kira-border/40 rounded-2xl rounded-tl-sm"
          : "bg-kira-accent/8 border border-kira-accent/15 rounded-2xl rounded-tr-sm"
      } px-4 py-3`}>
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-kira-text/90">
          {message.content}
        </div>
        <div className="flex items-center gap-2 mt-2">
          {message.isVoice && (
            <span className="text-[10px] text-kira-textMuted/30 flex items-center gap-0.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              </svg>
              voice
            </span>
          )}
          <span className="text-[10px] text-kira-textMuted/25 ml-auto">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </div>
  );
}
