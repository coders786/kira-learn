// ===== Trigger Engine v2 =====
// Decides when Kira should speak WITHOUT user prompt
// Evaluates: screen changes, silence, patterns, session duration, teaching state
// Built-in cooldowns and rate limiting to avoid spam

export type TriggerType =
  | "screen-comment"     // AI noticed something on screen
  | "screen-error"       // AI saw an error/mistake on screen
  | "screen-stuck"       // User hasn't changed screen in a while
  | "silence-short"      // User silent for 30s after question
  | "silence-medium"     // User silent for 60s
  | "silence-long"       // User silent for 120s
  | "pattern-short"      // 3+ short answers in a row
  | "pattern-vague"      // 2+ vague answers
  | "pattern-perfect"    // 3+ perfectionist loops
  | "session-long"       // Session > 30 min
  | "teaching-test"      // Time to test understanding
  | "teaching-push"      // Push user forward
  | "nudge-continue"     // After teaching, prompt to try
  | "tab-switch"         // User switched away from learning tool
  | "screen-blank";      // Screen went black/minimized

export interface TriggerResult {
  type: TriggerType;
  reason: string;
  prompt: string;       // What to send to AI to generate response
  priority: "low" | "medium" | "high";
  immediate: string | null; // If set, use this directly (no AI call needed)
}

export interface TriggerContext {
  // Timing
  now: number;
  lastUserMessageTime: number;
  lastAIMessageTime: number;
  sessionStartTime: number;

  // Message patterns
  recentUserMessages: string[];   // Last 5 user messages
  totalMessages: number;
  lastAIContent: string;

  // Screen state
  screenSharing: boolean;
  screenMode: "live" | "periodic" | "off";
  lastScreenAnalysisTime: number;
  screenApp: string;
  screenPage: string;
  screenShouldComment: boolean;
  screenComment: string;
  screenUrgency: "low" | "medium" | "high";

  // State
  isUserTyping: boolean;
  isLoading: boolean;
  currentPhase: string;
}

// ===== Cooldowns for each trigger type (ms) =====
const COOLDOWNS: Record<TriggerType, number> = {
  "screen-comment": 20000,   // 20s between screen comments
  "screen-error": 5000,      // 5s — errors are urgent
  "screen-stuck": 45000,     // 45s between stuck comments
  "silence-short": 30000,    // 30s between silence prompts
  "silence-medium": 60000,
  "silence-long": 120000,
  "pattern-short": 60000,
  "pattern-vague": 60000,
  "pattern-perfect": 60000,
  "session-long": 600000,    // 10 min between break suggestions
  "teaching-test": 120000,
  "teaching-push": 30000,
  "nudge-continue": 20000,
  "tab-switch": 30000,
  "screen-blank": 60000,
};

// Global cooldown: minimum time between ANY proactive messages
const GLOBAL_COOLDOWN_MS = 10000; // 10 seconds

export class TriggerEngine {
  private lastTriggerTime: number = 0;
  private lastTriggerByType: Record<string, number> = {};
  private consecutiveShortAnswers = 0;
  private consecutiveVagueAnswers = 0;
  private consecutivePerfectionist = 0;
  private proactiveMessageCount = 0;

  // ===== Record events =====
  recordUserMessage(content: string) {
    const lower = content.trim().toLowerCase();
    const wordCount = content.trim().split(/\s+/).length;

    // Track short answers
    if (wordCount <= 3 || /^(ok|okay|k|cool|got it|yep|yeah|sure|right|yes|no|maybe|idk|i guess|uh huh|mm hmm|alright)$/i.test(lower)) {
      this.consecutiveShortAnswers++;
    } else {
      this.consecutiveShortAnswers = 0;
    }

    // Track vague answers
    if (/\b(idk|i don'?t know|not sure|whatever|i guess|hmm|uh)\b/i.test(lower) && wordCount < 10) {
      this.consecutiveVagueAnswers++;
    } else {
      this.consecutiveVagueAnswers = 0;
    }

    // Track perfectionist loops
    if (/\b(what if.*wrong|are you sure|double check|is this.*right|perfect|good enough)\b/i.test(lower)) {
      this.consecutivePerfectionist++;
    } else {
      this.consecutivePerfectionist = 0;
    }
  }

  // ===== Main evaluation — call every 5 seconds =====
  evaluate(ctx: TriggerContext): TriggerResult | null {
    // Never trigger during onboarding or loading
    if (ctx.currentPhase !== "teaching") return null;
    if (ctx.isLoading) return null;
    if (ctx.isUserTyping) return null;

    const now = ctx.now;
    const silenceDuration = now - ctx.lastUserMessageTime;
    const timeSinceAI = now - ctx.lastAIMessageTime;
    const sessionDuration = now - ctx.sessionStartTime;

    // ===== PRIORITY 1: Screen errors (HIGH) =====
    if (ctx.screenSharing && ctx.screenShouldComment && ctx.screenUrgency === "high") {
      if (this.canTrigger("screen-error", now)) {
        return {
          type: "screen-error",
          reason: "Error detected on screen",
          prompt: `You noticed something urgent on the student's screen. Comment on it immediately. Be direct. Max 2 sentences.`,
          priority: "high",
          immediate: ctx.screenComment || null,
        };
      }
    }

    // ===== PRIORITY 2: Screen change comments (MEDIUM-HIGH) =====
    if (ctx.screenSharing && ctx.screenShouldComment && ctx.screenComment && timeSinceAI > 8000) {
      if (this.canTrigger("screen-comment", now)) {
        return {
          type: "screen-comment",
          reason: "Notable screen change detected",
          prompt: `You see the student's screen changed. Comment naturally. Max 2 sentences.`,
          priority: "medium",
          immediate: ctx.screenComment,
        };
      }
    }

    // ===== PRIORITY 3: Pattern — short answers (MEDIUM) =====
    if (this.consecutiveShortAnswers >= 3 && timeSinceAI > 5000) {
      if (this.canTrigger("pattern-short", now)) {
        this.consecutiveShortAnswers = 0; // Reset
        return {
          type: "pattern-short",
          reason: "3+ consecutive short answers",
          prompt: `The student has given 3+ short answers in a row (ok, yeah, sure, etc). They might be confused but not saying it. STOP asking questions. EXPLAIN the next thing clearly. Don't ask if they understand — just teach for 2 turns.`,
          priority: "medium",
          immediate: null,
        };
      }
    }

    // ===== PRIORITY 4: Pattern — vague answers (MEDIUM) =====
    if (this.consecutiveVagueAnswers >= 2 && timeSinceAI > 5000) {
      if (this.canTrigger("pattern-vague", now)) {
        this.consecutiveVagueAnswers = 0;
        return {
          type: "pattern-vague",
          reason: "2+ vague answers (idk, not sure)",
          prompt: `The student said "idk" or "not sure" 2+ times. STOP asking what they think. SUGGEST something specific. "Here's what I think you should try." Make a concrete recommendation.`,
          priority: "medium",
          immediate: null,
        };
      }
    }

    // ===== PRIORITY 5: Silence after AI asked a question (MEDIUM) =====
    const lastAI = ctx.lastAIContent.toLowerCase();
    const aiAskedQuestion = lastAI.includes("?") || /what|how|which|where|try|click|do you/.test(lastAI);
    if (aiAskedQuestion && silenceDuration > 30000 && timeSinceAI > 25000) {
      if (this.canTrigger("silence-short", now)) {
        return {
          type: "silence-short",
          reason: "User silent 30s after question",
          prompt: `You asked a question 30 seconds ago and they haven't responded. Rephrase or simplify your question. Or just tell them the answer. Max 2 sentences.`,
          priority: "medium",
          immediate: null,
        };
      }
    }

    // ===== PRIORITY 6: Medium silence (60s) =====
    if (silenceDuration > 60000 && timeSinceAI > 30000) {
      if (this.canTrigger("silence-medium", now)) {
        return {
          type: "silence-medium",
          reason: "User silent for 60s",
          prompt: `The student has been quiet for a minute. Check in briefly. Don't be annoying. Sound human. Max 2 sentences.`,
          priority: "low",
          immediate: null,
        };
      }
    }

    // ===== PRIORITY 7: Long silence (120s) =====
    if (silenceDuration > 120000 && timeSinceAI > 60000) {
      if (this.canTrigger("silence-long", now)) {
        return {
          type: "silence-long",
          reason: "User silent for 2 minutes",
          prompt: `The student has been silent for 2 minutes. A friendly check-in. Short. Warm. Not pushy.`,
          priority: "low",
          immediate: "you still there? no rush. take your time.",
        };
      }
    }

    // ===== PRIORITY 8: Screen stuck (user hasn't changed screen) =====
    if (ctx.screenSharing && ctx.screenMode === "live" && silenceDuration > 45000 && timeSinceAI > 30000) {
      if (this.canTrigger("screen-stuck", now)) {
        return {
          type: "screen-stuck",
          reason: "User on same screen for 45+ seconds",
          prompt: `The student has been on the same screen for a while. They might be stuck, reading, or confused. Briefly offer help or suggest the next action. Max 2 sentences.`,
          priority: "low",
          immediate: null,
        };
      }
    }

    // ===== PRIORITY 9: Pattern — perfectionist (LOW) =====
    if (this.consecutivePerfectionist >= 3 && timeSinceAI > 5000) {
      if (this.canTrigger("pattern-perfect", now)) {
        this.consecutivePerfectionist = 0;
        return {
          type: "pattern-perfect",
          reason: "3+ perfectionist loops",
          prompt: `The student keeps asking "are you sure?" or "what if it's wrong?" 3+ times. Stop reassuring. Push them to act. "There's no perfect. Launch it. Today." Firm but caring.`,
          priority: "medium",
          immediate: null,
        };
      }
    }

    // ===== PRIORITY 10: Nudge to continue after teaching =====
    const lastAIEndsWithTeach = /try it|your turn|go ahead|click.*button|let's see|now you|do this|try that/.test(lastAI);
    if (lastAIEndsWithTeach && silenceDuration > 15000 && timeSinceAI > 12000 && ctx.screenSharing) {
      if (this.canTrigger("nudge-continue", now)) {
        return {
          type: "nudge-continue",
          reason: "AI taught something, user hasn't acted",
          prompt: `You told the student to try something 15 seconds ago. They haven't done it yet. A gentle nudge. Reference the specific thing they should do.`,
          priority: "low",
          immediate: null,
        };
      }
    }

    // ===== PRIORITY 11: Long session break suggestion =====
    if (sessionDuration > 1800000 && ctx.totalMessages > 30 && timeSinceAI > 60000) {
      if (this.canTrigger("session-long", now)) {
        return {
          type: "session-long",
          reason: "Session over 30 minutes",
          prompt: `You've been teaching for 30+ minutes. Suggest a short break. Frame it as helping them learn better.`,
          priority: "low",
          immediate: null,
        };
      }
    }

    return null;
  }

  // ===== Check if trigger can fire (cooldowns) =====
  private canTrigger(type: TriggerType, now: number): boolean {
    // Global cooldown
    if (now - this.lastTriggerTime < GLOBAL_COOLDOWN_MS) return false;

    // Type-specific cooldown
    const typeCooldown = COOLDOWNS[type];
    const lastTypeTrigger = this.lastTriggerByType[type] || 0;
    if (now - lastTypeTrigger < typeCooldown) return false;

    return true;
  }

  // ===== Called when a trigger fires =====
  markTriggered(type: TriggerType) {
    const now = Date.now();
    this.lastTriggerTime = now;
    this.lastTriggerByType[type] = now;
    this.proactiveMessageCount++;
  }

  // ===== Reset (new session) =====
  reset() {
    this.lastTriggerTime = 0;
    this.lastTriggerByType = {};
    this.consecutiveShortAnswers = 0;
    this.consecutiveVagueAnswers = 0;
    this.consecutivePerfectionist = 0;
    this.proactiveMessageCount = 0;
  }

  get stats() {
    return {
      proactiveMessages: this.proactiveMessageCount,
      consecutiveShort: this.consecutiveShortAnswers,
      consecutiveVague: this.consecutiveVagueAnswers,
      consecutivePerfectionist: this.consecutivePerfectionist,
    };
  }
}
