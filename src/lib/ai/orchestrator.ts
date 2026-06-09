import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  PersonalityType,
  ConversationContext,
  Message,
} from "../types";
import { getSystemPrompt, getScreenAnalysisPrompt } from "./system-prompts";

// ===== AI Orchestrator v4 =====
// Fixed: response quality, context management, timeout handling

const MAX_HISTORY = 16; // Reduced from 20 — shorter context = better focus
const TIMEOUT_MS = 15000;

export class AIOrchestrator {
  private genAI: GoogleGenerativeAI;
  private chatModel;
  private visionModel;
  private fastModel;
  private recentOpenings: string[] = [];

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.chatModel = this.genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        temperature: 0.9,
        topP: 0.92,
        topK: 40,
        maxOutputTokens: 200, // v4: 150 was too short, 250 was too long. 200 is the sweet spot.
      },
    });

    this.visionModel = this.genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      generationConfig: { temperature: 0.65, topP: 0.9, maxOutputTokens: 150 },
    });

    this.fastModel = this.genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: { temperature: 0.15, maxOutputTokens: 60 },
    });
  }

  sanitizeInput(input: string) {
    const trimmed = input.trim();
    return {
      clean: trimmed,
      isEmpty: !trimmed,
      isGibberish: /^[^a-zA-Z]*$/.test(trimmed) || /^(.)\1{4,}$/.test(trimmed),
      isHostile: /\b(shut up|you suck|stupid|dumb|fuck|shit|idiot)\b/i.test(trimmed),
      isShort: trimmed.split(/\s+/).length <= 2,
      isEssay: trimmed.split(/\s+/).length > 50,
      isVague: /\b(idk|i don't know|not sure|whatever|i guess)\b/i.test(trimmed) && trimmed.split(/\s+/).length < 8,
      isPerfectionist: /\b(what if.*wrong|are you sure|double check|perfect|good enough)\b/i.test(trimmed),
      isEmotional: /\b(scared|nervous|afraid|excited|proud|believe|fail|failed)\b/i.test(trimmed),
      isOffTopic: /\b(meaning of life|are you.*robot|do you have feelings|hack|joke)\b/i.test(trimmed),
    };
  }

  getSpecialResponse(s: ReturnType<typeof this.sanitizeInput>): string | null {
    if (s.isEmpty) return "type something. anything you're thinking.";
    if (s.isGibberish) return "haha what? use words this time.";
    if (s.isHostile) return "i hear you. this stuff is frustrating. but i'm on your side. take a breath.";
    return null;
  }

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

    // Build focused context (keep it SHORT so the model doesn't get confused)
    const ctx = this.buildContext(context, screenData, userMessage);

    // Use shorter history for better focus
    const history = this.toHistory(context.messages);

    try {
      const chat = this.chatModel.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: systemPrompt }],
          },
          {
            role: "model",
            parts: [{ text: "got it. i'm kira. let's go." }],
          },
          // Inject context as a recent system message so it's not buried
          ...(ctx ? [{
            role: "user" as const,
            parts: [{ text: `[CONTEXT] ${ctx}` }],
          }, {
            role: "model" as const,
            parts: [{ text: "noted. ready." }],
          }] : []),
          ...history,
        ],
      });

      let result;
      try {
        result = await Promise.race([
          chat.sendMessage([{ text: userMessage }]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("TIMEOUT")), TIMEOUT_MS)
          ),
        ]);
      } catch (e: any) {
        if (e.message === "TIMEOUT") {
          // Retry with minimal context
          return this.retryMinimal(context, userMessage);
        }
        throw e;
      }

      const text = this.antiYapping(result.response.text());
      this.trackOpening(text);
      return text;

    } catch (error: any) {
      return this.getErrorFallback(context.user.personality, error);
    }
  }

  // Retry with minimal history when timed out
  private async retryMinimal(context: ConversationContext, userMessage: string): Promise<string> {
    try {
      const minimalHistory = this.toHistory(context.messages).slice(-4);
      const chat = this.chatModel.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: `You are Kira. Teaching ${context.user.tool} for ${context.user.realGoal}. Max 2 sentences. Be brief and helpful. Ask a question.` }],
          },
          { role: "model", parts: [{ text: "ready." }] },
          ...minimalHistory,
        ],
      });
      const result = await chat.sendMessage(userMessage);
      return this.antiYapping(result.response.text());
    } catch {
      return "hold on, thinking... try again?";
    }
  }

  async discoverGoal(messages: Message[]): Promise<{
    response: string;
    extractedGoal?: string;
    extractedRealGoal?: string;
  }> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: "gemini-3.1-flash-lite",
        generationConfig: { temperature: 0.9, maxOutputTokens: 180 },
      });

      const history = messages.map(m => ({
        role: (m.role === "ai" ? "model" : "user") as "model" | "user",
        parts: [{ text: m.content }],
      }));

      const chat = model.startChat({
        history: [
          { role: "user", parts: [{ text: GOAL_DISCOVERY_PROMPT }] },
          { role: "model", parts: [{ text: "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier." }] },
          ...history,
        ],
      });

      const lastUserMsg = messages.filter(m => m.role === "user").pop();
      if (!lastUserMsg) return { response: "hey. so. what are you trying to figure out right now?" };

      const result = await chat.sendMessage(lastUserMsg.content);
      const response = this.antiYapping(result.response.text());

      const extraction = await this.extractGoals(messages).catch(() => null);
      return {
        response,
        extractedGoal: extraction?.goal,
        extractedRealGoal: extraction?.realGoal,
      };
    } catch {
      return { response: "okay. tell me more. like, what would change if you could do this?" };
    }
  }

  private async extractGoals(messages: Message[]): Promise<{ goal: string; realGoal: string } | null> {
    const text = messages.map(m => `${m.role}: ${m.content}`).join("\n");
    try {
      const result = await this.fastModel.generateContent(
        `User wants to learn something. Extract:
1. Tool they want to learn
2. Real-life goal (why they want it)
If vague, set both to same.

Conversation:
${text}

JSON: {"goal":"...","realGoal":"..."}`
      );
      const raw = result.response.text().trim();
      const json = raw.replace(/^[^{]*/, "").replace(/[^}]*$/, "");
      const parsed = JSON.parse(json || "{}");
      return parsed.goal ? parsed : null;
    } catch {
      const first = messages.find(m => m.role === "user");
      return first ? { goal: first.content, realGoal: first.content } : null;
    }
  }

  async analyzeScreen(screenImage: string, tool: string, goal: string, recent: string): Promise<string> {
    try {
      const result = await this.visionModel.generateContent([
        `${getScreenAnalysisPrompt(tool, goal)}\nRecent: ${recent.slice(-300)}`,
        { inlineData: { mimeType: "image/jpeg", data: screenImage } },
      ]);
      return result.response.text();
    } catch { return ""; }
  }

  // ===== Context Builder (KEPT SHORT — long context kills response quality) =====
  private buildContext(context: ConversationContext, screenData?: string, userMessage?: string): string {
    const parts: string[] = [];

    if (screenData) parts.push(`SCREEN: You see their ${context.user.tool}.`);
    const mistakes = context.mistakes.filter(m => !m.resolved).slice(0, 2);
    if (mistakes.length) parts.push(`WATCH FOR: ${mistakes.map(m => m.description).join(", ")}`);
    if (context.mood === "tired") parts.push("USER IS TIRED. Offer a 5-min task.");
    if (context.mood === "slow") parts.push("USER IS SLOW. Be patient. Repeat.");

    // Pattern detection (SHORT — one line each)
    if (userMessage) {
      const recent = context.messages.filter(m => m.role === "user").slice(-3);
      const shortCount = recent.filter(m => m.content.split(/\s+/).length <= 2).length;
      if (shortCount >= 3) parts.push("PATTERN: 3+ short answers. STOP asking. EXPLAIN for 2 turns.");

      const vagueCount = recent.filter(m => /\b(idk|i don't know|not sure|whatever)\b/i.test(m.content)).length;
      if (vagueCount >= 2) parts.push("PATTERN: 2+ vague answers. STOP asking. SUGGEST something.");

      if (/\b(what if.*wrong|are you sure|perfect)\b/i.test(userMessage)) {
        const perfCount = recent.filter(m => /\b(what if.*wrong|are you sure|perfect)\b/i.test(m.content)).length;
        if (perfCount >= 2) parts.push("PATTERN: Perfectionist loop. PUSH them to act.");
      }
    }

    // Anti-repetition warning
    if (this.recentOpenings.length >= 3) {
      const last3 = this.recentOpenings.slice(-3);
      if (last3[0] === last3[1] && last3[1] === last3[2]) {
        parts.push(`WARNING: You opened with "${last3[0]}" 3x. Use DIFFERENT opening.`);
      }
    }

    return parts.join(" ");
  }

  private toHistory(messages: Message[]) {
    return messages
      .filter(m => m.role !== "system")
      .slice(-MAX_HISTORY)
      .map(m => ({ role: (m.role === "ai" ? "model" : "user") as "model" | "user", parts: [{ text: m.content }] }));
  }

  private trackOpening(text: string) {
    const first = text.split(/\s+/)[0]?.toLowerCase() || "";
    this.recentOpenings.push(first);
    if (this.recentOpenings.length > 6) this.recentOpenings.shift();
  }

  private antiYapping(text: string): string {
    let c = text.trim();
    if (c.length > 350) {
      const s = c.match(/[^.!?]+[.!?]+/g) || [];
      let r = "";
      for (const sentence of s) { if ((r + sentence).length > 300) break; r += sentence; }
      c = r || c.substring(0, 297) + "...";
    }
    const banned = [
      /as an ai[^.]*\.\s*/gi, /i'm here to help[^.]*\.\s*/gi,
      /feel free to[^.]*\.\s*/gi, /let me know if[^.]*\.\s*/gi,
      /i'm sorry you feel[^.]*\.\s*/gi, /i understand your[^.]*\.\s*/gi,
      /great question!?\s*/gi, /certainly!?\s*/gi,
      /it's important to note[^.]*\.\s*/gi,
      /don't hesitate to[^.]*\.\s*/gi, /in order to/gi,
    ];
    for (const p of banned) c = c.replace(p, "");
    return c.trim();
  }

  private getErrorFallback(p: PersonalityType, error?: any): string {
    const msg = error?.message || "";
    if (msg.includes("429") || msg.includes("quota"))
      return "rate limit hit. wait 30 seconds. free tier thing.";
    if (msg.includes("401") || msg.includes("API key"))
      return "API key not working. check it in settings.";
    const f: Record<PersonalityType, string> = {
      chill: "brain glitch. try again?",
      "drill-sergeant": "technical issue. my problem. repeat what you said.",
      patient: "small hiccup. say that again?",
      hype: "tiny glitch! say that again!",
    };
    return f[p];
  }
}

const GOAL_DISCOVERY_PROMPT = `You are Kira. Finding out what the user wants to learn.
Max 2 sentences. Warm. ONE question.
If "idk" or vague x2 → STOP asking. SUGGEST: "i think you should try [thing]. worst case, you learn."
If they name a tool → "what would you do the day you finished learning?"
If real goal found → "so your real goal is [goal]. cool?"
No: "as an AI", "I'm here to help", "feel free", "great question"`;
