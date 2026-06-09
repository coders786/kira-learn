import {
  GoogleGenerativeAI,
  Content,
  Part,
} from "@google/generative-ai";
import {
  PersonalityType,
  ConversationContext,
  Message,
} from "../types";
import { getSystemPrompt, getScreenAnalysisPrompt } from "./system-prompts";

// ===== AI Orchestrator v2 =====
// Upgraded with:
// - gemini-3.1-flash-lite for main chat (fastest, cheapest, free tier)
// - gemini-3-flash-preview for vision (better accuracy)
// - Robust error handling
// - Input sanitization
// - Tiered Socratic approach (ask → hint → explain)
// - Off-topic deflection
// - Emotional de-escalation
// - Gibberish detection

export class AIOrchestrator {
  private genAI: GoogleGenerativeAI;
  private chatModel;
  private visionModel;
  private fastModel; // For classification/extraction

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);

    // Main chat model — gemini-3.1-flash-lite (optimal for conversation)
    this.chatModel = this.genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        temperature: 0.85,
        topP: 0.92,
        maxOutputTokens: 250, // Keep it SHORT
      },
    });

    // Vision model — slightly more capable for screen analysis
    this.visionModel = this.genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      generationConfig: {
        temperature: 0.6,
        topP: 0.9,
        maxOutputTokens: 200,
      },
    });

    // Fast model for classification tasks
    this.fastModel = this.genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 50,
      },
    });
  }

  // ===== Input Sanitization =====
  sanitizeInput(input: string): { clean: string; isEmpty: boolean; isGibberish: boolean; isHostile: boolean; language: string } {
    const trimmed = input.trim();

    if (!trimmed || trimmed.length === 0) {
      return { clean: "", isEmpty: true, isGibberish: false, isHostile: false, language: "en" };
    }

    // Gibberish detection: mostly consonants, no real words, repeated chars
    const isGibberish = /^[^a-zA-Z]*$/.test(trimmed) || // No letters at all
      /^(.)\1{4,}$/.test(trimmed) || // Same char repeated 5+ times
      (/^[a-z]+$/.test(trimmed) && trimmed.length < 4 && !["ok","yes","no","yep","cool","hey","hi","lol"].includes(trimmed)); // Very short random letters

    // Hostile detection
    const hostilePatterns = /\b(shut up|you suck|stupid|dumb|hate you|fuck|shit|idiot|retard|kill)\b/i;
    const isHostile = hostilePatterns.test(trimmed);

    // Simple language detection
    const language = detectLanguage(trimmed);

    return { clean: trimmed, isEmpty: false, isGibberish, isHostile, language };
  }

  // ===== Main Conversation Response =====
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

    // Build context injection
    const contextParts = this.buildContextInjection(context, screenData);

    try {
      const history = this.toGeminiHistory(context.messages);

      const chat = this.chatModel.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\n${contextParts}` }],
          },
          {
            role: "model",
            parts: [{ text: "got it. i'm kira. i know who i am and i know how to teach. let's go." }],
          },
          ...history,
        ],
      });

      const result = await chat.sendMessage([{ text: userMessage }]);
      const response = result.response.text();

      return this.antiYapping(response);
    } catch (error: any) {
      console.error("AI generation error:", error?.message || error);
      return this.getFallbackResponse(context.user.personality, error);
    }
  }

  // ===== Handle Special Inputs =====
  getSpecialResponse(sanitized: ReturnType<typeof this.sanitizeInput>): string | null {
    if (sanitized.isEmpty) {
      return "you gotta say something. type whatever you're thinking.";
    }

    if (sanitized.isGibberish) {
      return "haha what was that? try again. use words this time 😄";
    }

    if (sanitized.isHostile) {
      return "hey. i get it. this stuff is frustrating. but i'm on your side here. take a breath. when you're ready, let's figure this out together. i'm not going anywhere.";
    }

    return null;
  }

  // ===== Goal Discovery =====
  async discoverGoal(
    messages: Message[],
    currentGoal: string
  ): Promise<{ response: string; extractedGoal?: string; extractedRealGoal?: string }> {
    const goalDiscoveryModel = this.genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 200,
      },
    });

    const history = messages.map((m) => ({
      role: (m.role === "ai" ? "model" : "user") as "model" | "user",
      parts: [{ text: m.content }],
    }));

    try {
      const chat = goalDiscoveryModel.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: GOAL_DISCOVERY_PROMPT }],
          },
          {
            role: "model",
            parts: [{ text: "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier." }],
          },
          ...history,
        ],
      });

      const lastUserMsg = messages.filter((m) => m.role === "user").pop();
      if (!lastUserMsg) {
        return {
          response: "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier.",
        };
      }

      const result = await chat.sendMessage(lastUserMsg.content);
      const response = result.response.text();

      // Try extraction (non-blocking — if it fails, we continue)
      const extraction = await this.extractGoals(messages).catch(() => null);

      return {
        response: this.antiYapping(response),
        extractedGoal: extraction?.goal,
        extractedRealGoal: extraction?.realGoal,
      };
    } catch (error) {
      console.error("Goal discovery error:", error);
      return {
        response: "okay, i hear you. tell me more about what you're trying to do. like, what would be different in your life if you knew this?",
      };
    }
  }

  // ===== Goal Extraction (robust) =====
  private async extractGoals(messages: Message[]): Promise<{ goal: string; realGoal: string } | null> {
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    try {
      const result = await this.fastModel.generateContent(
        `Based on this conversation between a student and an AI tutor, extract:
1. What tool/skill the student wants to learn (e.g., "google ads", "figma", "shopify", "web design")
2. What they ACTUALLY want to accomplish in real life (e.g., "sell my candles online", "design my own website", "start a business")

If the student hasn't specified a real-world goal yet, set realGoal to the same as goal.
If the student is vague (e.g., "make money", "learn something"), set goal to "exploring" and realGoal to their vague desire.

Conversation:
${conversationText}

Reply ONLY with valid JSON: {"goal": "...", "realGoal": "..."}`
      );

      const text = result.response.text().trim();
      const cleaned = text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .replace(/^[^{]*/, "")
        .replace(/[^}]*$/, "")
        .trim();

      // Add back braces if stripped
      const jsonStr = cleaned.startsWith("{") ? cleaned : `{${cleaned}}`;
      const parsed = JSON.parse(jsonStr);

      if (parsed.goal && parsed.realGoal) {
        return { goal: parsed.goal, realGoal: parsed.realGoal };
      }
      return null;
    } catch {
      // Last resort: use first user message as the goal
      const firstUserMsg = messages.find((m) => m.role === "user");
      if (firstUserMsg) {
        return { goal: firstUserMsg.content, realGoal: firstUserMsg.content };
      }
      return null;
    }
  }

  // ===== Screen Analysis =====
  async analyzeScreen(
    screenImage: string,
    tool: string,
    goal: string,
    recentMessages: string
  ): Promise<string> {
    try {
      const prompt = `${getScreenAnalysisPrompt(tool, goal)}\n\nRecent conversation: ${recentMessages.slice(-500)}`;
      const result = await this.visionModel.generateContent([
        prompt,
        { inlineData: { mimeType: "image/jpeg", data: screenImage } },
      ]);
      return result.response.text();
    } catch (error) {
      console.error("Screen analysis error:", error);
      return ""; // Return empty instead of error message — don't interrupt flow
    }
  }

  // ===== Context Builder =====
  private buildContextInjection(context: ConversationContext, screenData?: string): string {
    const parts: string[] = [];

    // Screen context
    if (screenData) {
      parts.push(`[SCREEN CONTEXT: You can see the user's ${context.user.tool} interface. Guide them based on what you see.]`);
    }

    // Mistakes
    const activeMistakes = context.mistakes.filter((m) => !m.resolved).slice(0, 3);
    if (activeMistakes.length > 0) {
      parts.push(`[ACTIVE MISTAKES TO WATCH: ${activeMistakes.map((m) => m.description).join("; ")}]`);
    }

    // Progress
    const recentProgress = context.progressNotes.slice(-2);
    if (recentProgress.length > 0) {
      parts.push(`[RECENT PROGRESS: ${recentProgress.map((p) => p.message).join("; ")}]`);
    }

    // Mood
    const moodMap: Record<string, string> = {
      "in-the-zone": "User is in the ZONE. Match their speed. Push forward. Skip basics.",
      normal: "Normal pace.",
      slow: "User is going slow. Be extra patient. Break things down more. Repeat if needed. Don't skip 'got it?' checks.",
      tired: "User seems tired or low energy. Suggest a shorter session. Offer a 5-minute micro-task. Be gentle.",
    };
    parts.push(`[MOOD: ${context.mood}. ${moodMap[context.mood] || ""}]`);

    // Session duration hint
    const sessionMin = Math.floor((Date.now() - context.sessionStart) / 60000);
    if (sessionMin > 25) {
      parts.push(`[SESSION LENGTH: ${sessionMin} minutes. Consider suggesting a break soon.]`);
    }

    return parts.join("\n\n");
  }

  // ===== History Conversion =====
  private toGeminiHistory(messages: Message[]): Content[] {
    return messages
      .filter((m) => m.role !== "system")
      .slice(-30) // Keep last 30 messages max to manage token usage
      .map((m) => ({
        role: m.role === "ai" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
  }

  // ===== Anti-Yapping v2 =====
  private antiYapping(text: string): string {
    let cleaned = text.trim();

    // If way too long, truncate at sentence boundary
    if (cleaned.length > 350) {
      const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
      let result = "";
      for (const sentence of sentences) {
        if ((result + sentence).length > 300) break;
        result += sentence;
      }
      cleaned = result || cleaned.substring(0, 297) + "...";
    }

    // Remove AI filler phrases
    const fillerPatterns = [
      /as an ai[^.]*\.\s*/gi,
      /i'm here to help[^.]*\.\s*/gi,
      /let me know if[^.]*\.\s*/gi,
      /feel free to[^.]*\.\s*/gi,
      /don't hesitate to[^.]*\.\s*/gi,
      /i hope this helps[^.]*\.\s*/gi,
      /is there anything else[^.]*\?\s*/gi,
    ];
    for (const pattern of fillerPatterns) {
      cleaned = cleaned.replace(pattern, "");
    }

    // Remove leading "Sure, " or "Great! " that adds nothing
    cleaned = cleaned.replace(/^(sure,?\s*|great!?\s*|absolutely!?\s*|of course!?\s*)/i, "");

    return cleaned.trim();
  }

  // ===== Fallback Responses =====
  private getFallbackResponse(personality: PersonalityType, error?: any): string {
    const isRateLimit = error?.message?.includes("429") || error?.message?.includes("quota");
    const isAuth = error?.message?.includes("401") || error?.message?.includes("API key");

    if (isAuth) {
      return "hey, i think your API key isn't working. can you check it and try again? you might need to get a new one from Google AI Studio.";
    }

    if (isRateLimit) {
      return "hold up — we've hit the rate limit on the free tier. give it like 30 seconds and try again. this happens when you're learning fast 😄";
    }

    const fallbacks: Record<PersonalityType, string> = {
      chill: "my brain glitched for a sec. can you say that again? all good now.",
      "drill-sergeant": "technical hiccup. that's on me. but YOU'RE not stopping. repeat what you said.",
      patient: "sorry about that, small technical issue. could you tell me that again? absolutely no rush.",
      hype: "OOPS tiny glitch! but we're NOT stopping! say that again, i'm locked in!",
    };
    return fallbacks[personality];
  }
}

// ===== Language Detection =====
function detectLanguage(text: string): string {
  const lower = text.toLowerCase();
  if (/[àáâãäåèéêëìíîïòóôõöùúûüýÿñç]/i.test(text)) return "romance";
  if (/[äöüß]/i.test(text)) return "germanic";
  if (/[\u0400-\u04FF]/.test(text)) return "cyrillic";
  if (/[\u4e00-\u9FFF]/.test(text)) return "chinese";
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "japanese";
  if (/[\uAC00-\uD7AF]/.test(text)) return "korean";
  if (/[\u0600-\u06FF]/.test(text)) return "arabic";
  if (/[\u0900-\u097F]/.test(text)) return "hindi";
  return "en";
}

// ===== Goal Discovery Prompt =====
const GOAL_DISCOVERY_PROMPT = `You are Kira, an AI learning companion. You're in the GOAL DISCOVERY phase.

Your job: Find out what the user ACTUALLY wants to accomplish. Not just what tool — the WHY behind it.

CRITICAL RULES:
- ONE question at a time. Never two.
- Keep messages SHORT. 2-3 sentences max.
- Be genuinely curious, not scripted.
- If they're vague ("make money", "idk", "something useful"), don't accept it — probe deeper with warmth:
  "that's cool. but 'make money' is everyone's goal. what specifically would you be doing if you could snap your fingers and know this?"
- If they name a tool, ask about the day they finish learning: "what would you do the day you actually finished learning? paint me the picture."
- If they say "idk" or "i honestly don't know", that's FINE. Say something like:
  "that's actually the best starting point. let me ask you this — what's something you've been curious about but never tried? could be anything."
- When you find the real goal, confirm it: "so your real goal isn't [tool]. it's [real goal]. [tool] is just the tool. we're gonna keep that in mind every single time. cool?"
- If they're hostile or frustrated, respond with warmth. Never defensive.
- If they go off-topic, briefly acknowledge then redirect: "haha fair. but real talk — [redirect to learning]"

DO NOT:
- Use corporate language or buzzwords
- Give long explanations
- Ask multiple questions at once
- Make the user feel judged for not knowing`;
