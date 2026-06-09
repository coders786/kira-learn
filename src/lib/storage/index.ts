// ===== Local Storage Manager =====
// All user data is stored locally in the browser for the prototype
// In production, this would be backed by a proper database

import {
  UserProfile,
  Mistake,
  Quest,
  ProgressNote,
  Message,
  APIConfig,
  PersonalityType,
} from "../types";

const KEYS = {
  USER: "kira_user",
  MISTAKES: "kira_mistakes",
  QUESTS: "kira_quests",
  PROGRESS: "kira_progress",
  MESSAGES: "kira_messages",
  API_CONFIG: "kira_api_config",
  ONBOARDED: "kira_onboarded",
  CURRENT_SESSION: "kira_current_session",
};

// ===== Generic helpers =====
function get<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function set<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Storage error:", e);
  }
}

// ===== API Config =====
export function getAPIConfig(): APIConfig {
  return get<APIConfig>(KEYS.API_CONFIG, {});
}

export function setAPIConfig(config: APIConfig): void {
  set(KEYS.API_CONFIG, config);
}

export function hasAPIKey(): boolean {
  const config = getAPIConfig();
  return !!(config.geminiKey || config.anthropicKey || config.openaiKey);
}

export function getGeminiKey(): string | null {
  return getAPIConfig().geminiKey || null;
}

// ===== User Profile =====
export function getUserProfile(): UserProfile | null {
  return get<UserProfile | null>(KEYS.USER, null);
}

export function setUserProfile(profile: UserProfile): void {
  set(KEYS.USER, profile);
}

export function updateUserProfile(
  updates: Partial<UserProfile>
): UserProfile | null {
  const current = getUserProfile();
  if (!current) return null;
  const updated = { ...current, ...updates };
  setUserProfile(updated);
  return updated;
}

export function isOnboarded(): boolean {
  return get<boolean>(KEYS.ONBOARDED, false);
}

export function setOnboarded(value: boolean): void {
  set(KEYS.ONBOARDED, value);
}

// ===== Mistakes =====
export function getMistakes(): Mistake[] {
  return get<Mistake[]>(KEYS.MISTAKES, []);
}

export function addMistake(mistake: Mistake): void {
  const mistakes = getMistakes();
  const existing = mistakes.find(
    (m) => m.category === mistake.category
  );
  if (existing) {
    existing.count++;
    existing.lastOccurrence = Date.now();
    set(KEYS.MISTAKES, mistakes);
  } else {
    mistakes.push(mistake);
    set(KEYS.MISTAKES, mistakes);
  }
}

export function resolveMistake(id: string): void {
  const mistakes = getMistakes();
  const mistake = mistakes.find((m) => m.id === id);
  if (mistake) {
    mistake.resolved = true;
    set(KEYS.MISTAKES, mistakes);
  }
}

export function getTopMistakes(count: number = 5): Mistake[] {
  return getMistakes()
    .filter((m) => !m.resolved)
    .sort((a, b) => b.count - a.count)
    .slice(0, count);
}

// ===== Quests =====
export function getQuests(): Quest[] {
  return get<Quest[]>(KEYS.QUESTS, []);
}

export function addQuest(quest: Quest): void {
  const quests = getQuests();
  quests.push(quest);
  set(KEYS.QUESTS, quests);
}

export function completeQuest(id: string): void {
  const quests = getQuests();
  const quest = quests.find((q) => q.id === id);
  if (quest) {
    quest.completed = true;
    set(KEYS.QUESTS, quests);
  }
}

export function getTodayQuest(): Quest | null {
  const today = new Date().toISOString().split("T")[0];
  const quests = getQuests();
  return quests.find((q) => q.date === today && !q.completed) || null;
}

// ===== Progress Notes =====
export function getProgressNotes(): ProgressNote[] {
  return get<ProgressNote[]>(KEYS.PROGRESS, []);
}

export function addProgressNote(note: ProgressNote): void {
  const notes = getProgressNotes();
  notes.push(note);
  set(KEYS.PROGRESS, notes);
}

// ===== Messages (Session) =====
export function getSessionMessages(): Message[] {
  return get<Message[]>(KEYS.MESSAGES, []);
}

export function setSessionMessages(messages: Message[]): void {
  // Keep only last 50 messages to manage storage
  set(KEYS.MESSAGES, messages.slice(-50));
}

export function addMessage(message: Message): void {
  const messages = getSessionMessages();
  messages.push(message);
  setSessionMessages(messages);
}

export function clearSession(): void {
  localStorage.removeItem(KEYS.MESSAGES);
  localStorage.removeItem(KEYS.CURRENT_SESSION);
}

// ===== Export all data =====
export function exportAllData(): Record<string, any> {
  return {
    user: getUserProfile(),
    mistakes: getMistakes(),
    quests: getQuests(),
    progress: getProgressNotes(),
    messages: getSessionMessages(),
  };
}

// ===== Clear all data =====
export function clearAllData(): void {
  Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
}
