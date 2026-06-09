// ===== Context Trigger System =====
// Detects when and why to generate responses based on:
// - Time since last message
// - Screen changes
// - User behavior patterns
// - Message source (voice, typing, screen event)

export interface TriggerContext {
  timeSinceLastMessage: number;  // ms
  timeSinceLastAIMessage: number; // ms
  userTyping: boolean;
  screenChanged: boolean;
  screenDescription?: string;
  lastMessageSource: "voice" | "typing" | "screen" | "system";
  lastAIContent: string;
  sessionDuration: number; // ms
  messagesInSession: number;
  consecutiveShortAnswers: number; // User giving short answers = possibly confused
  silenceDuration: number; // How long user has been silent
}

export interface TriggerResult {
  shouldRespond: boolean;
  reason?: string;
  responseType?: "proactive" | "reactive" | "check-in" | "screen-comment";
  suggestedContent?: string;
  priority: "low" | "medium" | "high";
}

// The trigger engine evaluates context and decides when/how to respond
export function evaluateTriggers(ctx: TriggerContext): TriggerResult {
  // ===== HIGH PRIORITY: Screen-based triggers =====

  // If screen changed and AI hasn't commented in 10+ seconds
  if (ctx.screenChanged && ctx.timeSinceLastAIMessage > 10000) {
    return {
      shouldRespond: true,
      reason: "screen_changed",
      responseType: "screen-comment",
      suggestedContent: "i see you moved to a new page. ",
      priority: "high",
    };
  }

  // ===== MEDIUM PRIORITY: Behavioral triggers =====

  // User has been silent for 2+ minutes (might be stuck or confused)
  if (ctx.silenceDuration > 120000 && ctx.messagesInSession > 4) {
    return {
      shouldRespond: true,
      reason: "long_silence",
      responseType: "check-in",
      suggestedContent: "you still there? no rush. take your time.",
      priority: "medium",
    };
  }

  // User giving very short answers repeatedly (might be confused but won't say it)
  if (ctx.consecutiveShortAnswers >= 3) {
    return {
      shouldRespond: true,
      reason: "short_answers_confusion",
      responseType: "check-in",
      suggestedContent:
        "hey. you're giving short answers and that's cool. but i want to make sure you're actually getting it. want me to explain that last thing again? or differently?",
      priority: "medium",
    };
  }

  // Session has been going for 30+ minutes (suggest break)
  if (ctx.sessionDuration > 1800000 && ctx.messagesInSession > 30) {
    return {
      shouldRespond: true,
      reason: "long_session",
      responseType: "check-in",
      suggestedContent:
        "we've been going for 30 minutes. you want to take a break? your brain actually processes this stuff better when you step away for a bit.",
      priority: "low",
    };
  }

  return { shouldRespond: false, priority: "low" };
}

// Detect if user message is "short" (confusion signal)
export function isShortAnswer(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  const shortPatterns = [
    /^(ok|okay|k|cool|got it|yep|yeah|sure|right|yes|no|maybe|idk|i guess)$/i,
    /^(sure thing|sounds good|makes sense|i think so)$/i,
  ];
  return trimmed.length < 15 || shortPatterns.some(p => p.test(trimmed));
}

// Detect confusion signals in user messages
export function detectConfusionSignals(text: string): string[] {
  const signals: string[] = [];
  const lower = text.toLowerCase();

  if (/wait|hold on|slow down|too fast/.test(lower)) signals.push("too_fast");
  if (/confused|lost|don't get|don't understand|what\?/.test(lower)) signals.push("confused");
  if (/too much|overwhelming|a lot/.test(lower)) signals.push("overwhelmed");
  if (/why\?|how come/.test(lower)) signals.push("curious");
  if (/can you repeat|say that again|one more time/.test(lower)) signals.push("needs_repetition");
  if (/i think|maybe|not sure|i guess/.test(lower)) signals.push("uncertain");

  return signals;
}

// Detect energy signals in user messages
export function detectEnergySignals(text: string): "high" | "medium" | "low" | "none" {
  const lower = text.toLowerCase();

  // High energy signals
  if (/!{2,}|yesss|let's go|awesome|amazing|love it|fire|🔥/.test(lower)) return "high";
  if (text === text.toUpperCase() && text.length > 3) return "high";

  // Low energy signals
  if (/tired|exhausted|brain dead|done|whatever|fine/.test(lower)) return "low";
  if (text.trim().length < 5) return "low";

  return "medium";
}

// Track consecutive short answers
export class ConversationTracker {
  private shortAnswerCount = 0;
  private lastMessageTime = Date.now();
  private sessionStart = Date.now();
  private messageCount = 0;

  recordUserMessage(content: string): {
    shortAnswerCount: number;
    silenceDuration: number;
    confusionSignals: string[];
    energyLevel: "high" | "medium" | "low" | "none";
  } {
    const now = Date.now();
    const silenceDuration = now - this.lastMessageTime;
    this.lastMessageTime = now;
    this.messageCount++;

    if (isShortAnswer(content)) {
      this.shortAnswerCount++;
    } else {
      this.shortAnswerCount = 0;
    }

    return {
      shortAnswerCount: this.shortAnswerCount,
      silenceDuration,
      confusionSignals: detectConfusionSignals(content),
      energyLevel: detectEnergySignals(content),
    };
  }

  getTriggerContext(lastAIMessageTime: number, screenChanged: boolean): TriggerContext {
    const now = Date.now();
    return {
      timeSinceLastMessage: now - this.lastMessageTime,
      timeSinceLastAIMessage: now - lastAIMessageTime,
      userTyping: false,
      screenChanged,
      lastMessageSource: "typing",
      lastAIContent: "",
      sessionDuration: now - this.sessionStart,
      messagesInSession: this.messageCount,
      consecutiveShortAnswers: this.shortAnswerCount,
      silenceDuration: now - this.lastMessageTime,
    };
  }

  reset() {
    this.shortAnswerCount = 0;
    this.lastMessageTime = Date.now();
    this.sessionStart = Date.now();
    this.messageCount = 0;
  }
}
