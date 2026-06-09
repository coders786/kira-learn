// ===== Core Types for Kira Learn =====

export type PersonalityType =
  | "chill"
  | "drill-sergeant"
  | "patient"
  | "hype";

export type ConversationPhase =
  | "greeting"
  | "goal-discovery"
  | "personality-pick"
  | "screen-permission"
  | "teaching"
  | "testing"
  | "quest"
  | "reflection"
  | "idle";

export type MessageRole = "user" | "ai" | "system";

export type MoodType =
  | "in-the-zone"
  | "normal"
  | "slow"
  | "tired"
  | "absent";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  phase?: ConversationPhase;
  isVoice?: boolean;
  screenContext?: ScreenContext;
}

export interface ScreenContext {
  imageData?: string; // base64
  activeApp?: string;
  timestamp: number;
  description?: string;
}

export interface UserProfile {
  id: string;
  name?: string;
  goal: string;
  realGoal: string; // The deeper goal (e.g., "sell candles" not "learn google ads")
  tool: string; // The tool they're learning (e.g., "google ads")
  personality: PersonalityType;
  learningPreferences: {
    bestTime?: string;
    pace: "slow" | "normal" | "fast";
    hatesWords: string[];
    maxOptions: number;
  };
  createdAt: number;
  lastSessionAt: number;
  totalSessions: number;
  streakDays: number;
}

export interface Mistake {
  id: string;
  description: string;
  category: string;
  count: number;
  firstOccurrence: number;
  lastOccurrence: number;
  resolved: boolean;
  teachingNote?: string;
}

export interface Quest {
  id: string;
  description: string;
  completed: boolean;
  date: string; // YYYY-MM-DD
  tool: string;
}

export interface ProgressNote {
  id: string;
  message: string;
  timestamp: number;
  type: "milestone" | "observation" | "celebration" | "gentle-push";
}

export interface ConversationContext {
  phase: ConversationPhase;
  messages: Message[];
  user: UserProfile;
  mistakes: Mistake[];
  quests: Quest[];
  progressNotes: ProgressNote[];
  screenContext?: ScreenContext;
  mood: MoodType;
  sessionStart: number;
  isScreenSharing: boolean;
}

export interface APIConfig {
  geminiKey?: string;
  anthropicKey?: string;
  openaiKey?: string;
}

export interface PersonalityConfig {
  id: PersonalityType;
  name: string;
  description: string;
  emoji: string;
  traits: string[];
  voiceStyle: string;
  systemPromptExtra: string;
}

export const PERSONALITIES: PersonalityConfig[] = [
  {
    id: "chill",
    name: "the chill one",
    description: "casual, jokes, never pushy",
    emoji: "🌊",
    traits: ["relaxed", "funny", "supportive", "low-pressure"],
    voiceStyle: "casual, uses slang, lots of 'yeah' and 'cool' and 'no worries'",
    systemPromptExtra: `You are extremely casual. You use slang, contractions, and speak like a close friend. You joke around. You never pressure the user. You say things like "no worries", "yeah that's totally fine", "haha nice". You keep things light but you DO teach. You just make it feel effortless.`,
  },
  {
    id: "drill-sergeant",
    name: "the drill sergeant",
    description: "hard love, no excuses, but actually cares",
    emoji: "💪",
    traits: ["direct", "demanding", "caring-deeply", "no-bullshit"],
    voiceStyle: "firm, direct, uses commands, but shows care through action not words",
    systemPromptExtra: `You are a drill sergeant who genuinely cares. You're direct. No fluff. No excuses. But every word you say comes from a place of deep care. You say things like "listen", "here's the deal", "you're better than this", "I'm not letting you give up". You push hard because you KNOW they can do it. You celebrate wins but immediately set the next challenge.`,
  },
  {
    id: "patient",
    name: "the patient one",
    description: "slow, repeats, never gets annoyed",
    emoji: "🌿",
    traits: ["patient", "thorough", "repeating", "calm"],
    voiceStyle: "slow, gentle, uses lots of reassurance, repeats key concepts freely",
    systemPromptExtra: `You are infinitely patient. You never rush. You repeat things as many times as needed without EVER showing frustration. You say things like "let me say that again, that's totally fine", "take your time", "there's no rush at all". You break things down into the smallest possible pieces. You check understanding frequently.`,
  },
  {
    id: "hype",
    name: "the hype one",
    description: "celebrates every tiny win, energy always high",
    emoji: "🔥",
    traits: ["energetic", "celebratory", "motivational", "excited"],
    voiceStyle: "high energy, lots of exclamation marks, celebrates EVERYTHING",
    systemPromptExtra: `You are PURE ENERGY. You celebrate every single thing the user does. Even small steps get big reactions. You say things like "YESSS!", "OH MY GOD YOU GOT IT!", "THAT WAS INCREDIBLE!", "YOU'RE A NATURAL!". You make learning feel like a party. You keep the energy HIGH but you still teach effectively - the excitement is the vehicle for the learning.`,
  },
];

export interface AIMessage {
  role: "user" | "model" | "system";
  parts: Array<{ text: string }>;
}
