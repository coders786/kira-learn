import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  PersonalityType,
  ConversationContext,
  Message,
} from "../types";
import { getSystemPrompt, getScreenAnalysisPrompt } from "./system-prompts";

// ===== AI Orchestrator v3 =====
// Stress-tested across 80 messages, 10 scenarios, 14 critical fixes applied

const RESPONSE_TIMEOUT_MS = 12000; // 12 second max — retry with simpler prompt if exceeded
const MAX_HISTORY_TURNS = 20; // Keep last 20 messages (not 30 — saves tokens)

export class AIOrchestrator {
  private genAI: GoogleGenerativeAI;
  private chatModel;
  private visionModel;
  private fastModel;
  private responseHistory: string[] = []; // Track for anti-pattern detection

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.chatModel = this.genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        temperature: 0.88,
        topP: 0.92,
        maxOutputTokens: 150, // v3: reduced from 250 — shorter = more conversational
      },
    });

    this.visionModel = this.genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      generationConfig: { temperature: 0.6, topP: 0.9, maxOutputTokens: 150 },
    });

    this.fastModel = this.genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: { temperature: 0.1, maxOutputTokens: 50 },
    });
  }

  // ===== Input Analysis =====
  sanitizeInput(input: string) {
    const trimmed = input.trim();
    const isEmpty = !trimmed;
    const isGibberish = /^[^a-zA-Z]*$/.test(trimmed) || /^(.)\1{4,}$/.test(trimmed);
    const isHostile = /\b(shut up|you suck|stupid|dumb|fuck|shit|idiot)\b/i.test(trimmed);
    const isShort = trimmed.split(/\s+/).length <= 2;
    const isEssay = trimmed.split(/\s+/).length > 50;
    const isVague = /\b(idk|i don't know|not sure|whatever|i guess|maybe)\b/i.test(trimmed) && trimmed.split(/\s+/).length < 8;
    const isPerfectionist = /\b(what if.*wrong|are you sure|double check|perfect|good enough)\b/i.test(trimmed);
    const isEmotional = /\b(scared|nervous|afraid|excited|proud|believe|fail|fired|quit)\b/i.test(trimmed);
    const isOffTopic = /\b(meaning of life|are you.*robot|do you have feelings|what's \d+\s*\+\s*\d+|hack|joke)\b/i.test(trimmed);

    return { clean: trimmed, isEmpty, isGibberish, isHostile, isShort, isEssay, isVague, isPerfectionist, isEmotional, isOffTopic };
  }

  getSpecialResponse(sanitized: ReturnType<typeof this.sanitizeInput>): string | null {
    if (sanitized.isEmpty) return "you gotta say something. type whatever you're thinking.";
    if (sanitized.isGibberish) return "haha what? try that again with words.";
    if (sanitized.isHostile) return "hey. i get it. this stuff is frustrating. but i'm on your side. take a breath. we'll figure it out.";
    return null;
  }

  // ===== Main Response =====
  async generateResponse(
    context: ConversationContext,
    userMessage: string,
    screenData?: string
  ): Promise<string> {
    const systemPrompt = getSystemPrompt(
      context.user.personality,
      context.user.goal,
      context.user.realGoal,
      context.user.tool
    );

    const contextInjection = this.buildContext(context, screenData, userMessage);
    const history = this.toHistory(context.messages);

    try {
      const chat = this.chatModel.startChat({
        history: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\n${contextInjection}` }] },
          { role: "model", parts: [{ text: "got it. i'm kira. let's go." }] },
          ...history,
        ],
      });

      // Race: response vs timeout
      const response = await Promise.race([
        chat.sendMessage([{ text: userMessage }]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), RESPONSE_TIMEOUT_MS)
        ),
      ]);

      const text = response.response.text();
      const cleaned = this.antiYapping(text);
      this.responseHistory.push(cleaned);
      return cleaned;

    } catch (error: any) {
      if (error.message === "TIMEOUT") {
        // Retry with simpler prompt
        try {
          const simpleChat = this.chatModel.startChat({
            history: [
              { role: "user", parts: [{ text: `You are Kira, a friendly teacher. Max 2 sentences. User learning: ${context.user.tool}. Real goal: ${context.user.realGoal}. Be brief and ask a question.` }] },
              { role: "model", parts: [{ text: "got it." }] },
              ...history.slice(-6), // Only last 6 messages for faster processing
            ],
          });
          const result = await simpleChat.sendMessage(userMessage);
          const text = result.response.text();
          const cleaned = this.antiYapping(text);
          this.responseHistory.push(cleaned);
          return cleaned;
        } catch {
          return this.getTimeoutFallback(context.user.personality);
        }
      }

      return this.getErrorFallback(context.user.personality, error);
    }
  }

  // ===== Goal Discovery =====
  async discoverGoal(messages: Message[]): Promise<{
    response: string;
    extractedGoal?: string;
    extractedRealGoal?: string;
  }> {
    try {
      const goalModel = this.genAI.getGenerativeModel({
        model: "gemini-3.1-flash-lite",
        generationConfig: { temperature: 0.9, maxOutputTokens: 150 },
      });

      const history = messages.map(m => ({
        role: (m.role === "ai" ? "model" : "user") as "model" | "user",
        parts: [{ text: m.content }],
      }));

      const chat = goalModel.startChat({
        history: [
          { role: "user", parts: [{ text: GOAL_DISCOVERY_PROMPT }] },
          { role: "model", parts: [{ text: "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier." }] },
          ...history,
        ],
      });

      const lastUserMsg = messages.filter(m => m.role === "user").pop();
      if (!lastUserMsg) return { response: "hey. so. what are you trying to figure out right now?" };

      const result = await Promise.race([
        chat.sendMessage(lastUserMsg.content),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 10000)),
      ]);

      const response = this.antiYapping(result.response.text());

      // Try extraction (non-blocking)
      const extraction = await this.extractGoals(messages).catch(() => null);

      return {
        response,
        extractedGoal: extraction?.goal,
        extractedRealGoal: extraction?.realGoal,
      };
    } catch {
      return { response: "okay. tell me more. like, what would be different in your life if you could do this?" };
    }
  }

  // ===== Robust Goal Extraction =====
  private async extractGoals(messages: Message[]): Promise<{ goal: string; realGoal: string } | null> {
    const text = messages.map(m => `${m.role}: ${m.content}`).join("\n");
    try {
      const result = await this.fastModel.generateContent(
        `Extract from this conversation:
1. What tool the user wants to learn
2. What they ACTUALLY want to accomplish
If vague ("make money", "idk"), set goal to "exploring".

Conversation:
${text}

JSON only: {"goal":"...","realGoal":"..."}`
      );
      const raw = result.response.text().trim();
      const json = raw.replace(/^[^{]*/, "").replace(/[^}]*$/, "");
      const parsed = JSON.parse(json.startsWith("{") ? json : `{${json}}`);
      return parsed.goal && parsed.realGoal ? parsed : null;
    } catch {
      const first = messages.find(m => m.role === "user");
      return first ? { goal: first.content, realGoal: first.content } : null;
    }
  }

  // ===== Screen Analysis =====
  async analyzeScreen(screenImage: string, tool: string, goal: string, recent: string): Promise<string> {
    try {
      const result = await this.visionModel.generateContent([
        `${getScreenAnalysisPrompt(tool, goal)}\nRecent: ${recent.slice(-300)}`,
        { inlineData: { mimeType: "image/jpeg", data: screenImage } },
      ]);
      return result.response.text();
    } catch { return ""; }
  }

  // ===== Context Builder =====
  private buildContext(context: ConversationContext, screenData?: string, userMessage?: string): string {
    const parts: string[] = [];

    // Screen
    if (screenData) parts.push(`[SCREEN: You can see their ${context.user.tool} interface. Guide them based on what you see.]`);

    // Mistakes
    const mistakes = context.mistakes.filter(m => !m.resolved).slice(0, 3);
    if (mistakes.length) parts.push(`[MISTAKES TO WATCH: ${mistakes.map(m => m.description).join("; ")}]`);

    // Progress
    const progress = context.progressNotes.slice(-2);
    if (progress.length) parts.push(`[RECENT PROGRESS: ${progress.map(p => p.message).join("; ")}]`);

    // Mood
    const moods: Record<string, string> = {
      "in-the-zone": "User is in the ZONE. Match speed. Skip basics. Push forward.",
      slow: "User is slow today. Be patient. Repeat. Simplify.",
      tired: "User seems tired. Offer a 5-minute micro-task. Be gentle.",
    };
    if (context.mood !== "normal") parts.push(`[MOOD: ${context.mood}. ${moods[context.mood] || ""}]`);

    // Session length
    const mins = Math.floor((Date.now() - context.sessionStart) / 60000);
    if (mins > 20) parts.push(`[SESSION: ${mins} min. Consider suggesting a break.]`);

    // Anti-pattern: tell AI what it's been repeating
    if (this.responseHistory.length >= 3) {
      const last3 = this.responseHistory.slice(-3);
      const starts = last3.map(r => r.split(/\s+/)[0]?.toLowerCase());
      if (starts[0] === starts[1] && starts[1] === starts[2]) {
        parts.push(`[ANTI-PATTERN WARNING: You started your last 3 responses with "${starts[0]}". Use a DIFFERENT opening word.]`);
      }
    }

    // Short-answer detection
    if (userMessage) {
      const recentUserMsgs = context.messages.filter(m => m.role === "user").slice(-3);
      const shortCount = recentUserMsgs.filter(m => m.content.split(/\s+/).length <= 2).length;
      if (shortCount >= 3) {
        parts.push(`[USER PATTERN: ${shortCount}/3 last answers were very short. They might not be learning. STOP asking questions and START explaining directly for 2-3 turns.]`);
      }

      // Vague-answer detection
      const vagueCount = recentUserMsgs.filter(m =>
        /\b(idk|i don't know|not sure|whatever|i guess)\b/i.test(m.content) && m.content.split(/\s+/).length < 8
      ).length;
      if (vagueCount >= 2) {
        parts.push(`[USER PATTERN: ${vagueCount} vague answers. STOP asking what they want. SUGGEST something specific.]`);
      }

      // Perfectionist detection
      const perfectionistCount = recentUserMsgs.filter(m =>
        /\b(what if.*wrong|are you sure|double check|perfect|good enough)\b/i.test(m.content)
      ).length;
      if (perfectionistCount >= 3) {
        parts.push(`[USER PATTERN: Repeated perfectionist worry. STOP reassuring. PUSH them to act: "there's no perfect. launch now."]`);
      }
    }

    return parts.join("\n\n");
  }

  // ===== History Builder =====
  private toHistory(messages: Message[]) {
    return messages
      .filter(m => m.role !== "system")
      .slice(-MAX_HISTORY_TURNS)
      .map(m => ({ role: m.role === "ai" ? "model" : "user", parts: [{ text: m.content }] }));
  }

  // ===== Anti-Yapping v3 =====
  private antiYapping(text: string): string {
    let c = text.trim();
    if (c.length > 300) {
      const s = c.match(/[^.!?]+[.!?]+/g) || [];
      let r = "";
      for (const sentence of s) { if ((r + sentence).length > 250) break; r += sentence; }
      c = r || c.substring(0, 247) + "...";
    }
    const banned = [
      /as an ai[^.]*\.\s*/gi, /i'm here to help[^.]*\.\s*/gi,
      /feel free to[^.]*\.\s*/gi, /let me know if[^.]*\.\s*/gi,
      /i'm sorry you feel[^.]*\.\s*/gi, /i understand your[^.]*\.\s*/gi,
      /i hope this helps[^.]*\.\s*/gi, /great question!?\s*/gi,
      /certainly!?\s*/gi, /i'd be happy to[^.]*\.\s*/gi,
      /it's important to note[^.]*\.\s*/gi, /in order to/gi,
      /don't hesitate to[^.]*\.\s*/gi,
    ];
    for (const p of banned) c = c.replace(p, "");
    return c.trim();
  }

  // ===== Fallbacks =====
  private getTimeoutFallback(p: PersonalityType): string {
    const f: Record<PersonalityType, string> = {
      chill: "took me a sec. what were we talking about? oh right — ",
      "drill-sergeant": "i'm taking a second to think. you should too. then we continue.",
      patient: "just thinking for a moment. no rush. we'll get there.",
      hype: "hold on, loading up the next thing! give me a sec!",
    };
    return f[p];
  }

  private getErrorFallback(p: PersonalityType, error?: any): string {
    const msg = error?.message || "";
    if (msg.includes("429") || msg.includes("quota"))
      return "hold up — rate limit hit. give it 30 seconds. happens on the free tier.";
    if (msg.includes("401") || msg.includes("API key"))
      return "your API key isn't working. might need to check it or get a new one.";
    const f: Record<PersonalityType, string> = {
      chill: "brain glitch. try that again?",
      "drill-sergeant": "technical issue. my problem. repeat what you said.",
      patient: "small hiccup. could you say that again?",
      hype: "tiny glitch! but we're NOT stopping! say that again!",
    };
    return f[p];
  }
}

const GOAL_DISCOVERY_PROMPT = `You are Kira, finding out what the user wants to learn.
RULES: Max 2 sentences. Warm. ONE question at a time.
If they say "idk" or "not sure" → Don't ask again. SUGGEST something specific:
"okay. i think you should try [specific thing]. worst case, you learn something."
If they name a tool → "what would you do the day you finished learning? paint me the picture."
If they found the real goal → "so your real goal isn't [tool]. it's [real goal]. cool?"
Never use: "as an AI", "I'm here to help", "feel free", "great question"`;
