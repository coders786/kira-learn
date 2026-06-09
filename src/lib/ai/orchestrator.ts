import {
  GoogleGenerativeAI,
  Content,
  Part,
} from "@google/generative-ai";
import {
  PersonalityType,
  ConversationContext,
  AIMessage,
  Message,
  ScreenContext,
} from "../types";
import { getSystemPrompt, getScreenAnalysisPrompt } from "./system-prompts";

// ===== AI Orchestrator =====
// Central brain that manages all AI interactions

export class AIOrchestrator {
  private genAI: GoogleGenerativeAI;
  private model;
  private visionModel;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.85,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 300, // Keep responses SHORT - anti-yapping
      },
    });
    this.visionModel = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 200,
      },
    });
  }

  // Convert our messages to Gemini format
  private toGeminiHistory(messages: Message[]): Content[] {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "ai" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
  }

  // Main conversation response
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

    // Build screen context if available
    let screenContext = "";
    if (screenData) {
      screenContext = `\n\n[SCREEN CONTEXT - The user is sharing their screen. Here's what you can see: The user is currently on their ${context.user.tool} interface.]`;
    }

    // Build mistake context
    const activeMistakes = context.mistakes
      .filter((m) => !m.resolved)
      .slice(0, 3);
    const mistakeContext =
      activeMistakes.length > 0
        ? `\n\n[USER'S ACTIVE MISTAKES TO WATCH FOR: ${activeMistakes
            .map((m) => `${m.description} (${m.count} times)`)
            .join("; ")}]`
        : "";

    // Build progress context
    const recentProgress = context.progressNotes.slice(-2);
    const progressContext =
      recentProgress.length > 0
        ? `\n\n[RECENT PROGRESS: ${recentProgress
            .map((p) => p.message)
            .join("; ")}]`
        : "";

    // Build mood context
    const moodContext = `\n\n[DETECTED USER MOOD: ${context.mood}. ${
      context.mood === "tired"
        ? "The user seems tired. Consider offering a shorter session or a break."
        : context.mood === "in-the-zone"
        ? "The user is in the zone! Match their energy, keep moving."
        : context.mood === "slow"
        ? "The user is going slow today. Be patient, repeat if needed."
        : ""
    }]`;

    try {
      const history = this.toGeminiHistory(context.messages);

      // Prepare the message parts
      const parts: Part[] = [{ text: userMessage }];

      const chat = this.model.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: `SYSTEM INSTRUCTIONS (you are Kira):\n${systemPrompt}${screenContext}${mistakeContext}${progressContext}${moodContext}` }],
          },
          {
            role: "model",
            parts: [
              {
                text: "got it. i'm kira. i know who i am, i know who they are, and i know how to teach. let's go.",
              },
            ],
          },
          ...history,
        ],
      });

      const result = await chat.sendMessage(parts);
      const response = result.response.text();

      // Post-process: enforce anti-yapping
      return this.antiYapping(response);
    } catch (error: any) {
      console.error("AI generation error:", error);
      // Fallback responses based on personality
      return this.getFallbackResponse(context.user.personality);
    }
  }

  // Analyze screen content
  async analyzeScreen(
    screenImage: string, // base64
    tool: string,
    goal: string,
    recentMessages: string
  ): Promise<string> {
    try {
      const prompt = `${getScreenAnalysisPrompt(tool, goal)}\n\nRecent conversation context: ${recentMessages.slice(-500)}`;

      const result = await this.visionModel.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: "image/png",
            data: screenImage,
          },
        },
      ]);

      return result.response.text();
    } catch (error) {
      console.error("Screen analysis error:", error);
      return "i can see your screen but i'm having trouble processing it right now. let's keep going and i'll try again in a moment.";
    }
  }

  // Generate goal discovery response
  async discoverGoal(
    messages: Message[],
    currentGoal: string
  ): Promise<{ response: string; extractedGoal?: string; extractedRealGoal?: string }> {
    const goalDiscoveryModel = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
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
            parts: [{ text: getGoalDiscoveryPromptFromSystemPrompts() }],
          },
          {
            role: "model",
            parts: [
              {
                text: "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier.",
              },
            ],
          },
          ...history,
        ],
      });

      const lastUserMsg = messages.filter((m) => m.role === "user").pop();
      if (!lastUserMsg) {
        return {
          response:
            "hey. so. what are you trying to figure out right now? just type it. or say it. whatever's easier.",
        };
      }

      const result = await chat.sendMessage(lastUserMsg.content);
      const response = result.response.text();

      // Try to extract goals from the conversation
      const extraction = await this.extractGoals(messages);

      return {
        response: this.antiYapping(response),
        extractedGoal: extraction?.goal,
        extractedRealGoal: extraction?.realGoal,
      };
    } catch (error) {
      console.error("Goal discovery error:", error);
      return {
        response: "okay, i hear you. tell me more about what you're trying to do.",
      };
    }
  }

  // Extract structured goals from conversation
  private async extractGoals(
    messages: Message[]
  ): Promise<{ goal: string; realGoal: string } | null> {
    const extractionModel = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 100,
      },
    });

    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    try {
      const result = await extractionModel.generateContent(
        `Based on this conversation, extract two things:
1. What tool/topic the user wants to learn (the "tool")
2. What they ACTUALLY want to accomplish (the "real goal")

Conversation:
${conversationText}

Respond in this exact JSON format only:
{"tool": "what they want to learn", "realGoal": "what they actually want to accomplish"}

If you can't determine both, respond with null`
      );

      const text = result.response.text().trim();
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.tool && parsed.realGoal) {
        return { goal: parsed.tool, realGoal: parsed.realGoal };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Anti-yapping: ensure responses are SHORT
  private antiYapping(text: string): string {
    // Remove any trailing fluff
    let cleaned = text.trim();

    // If response is way too long, truncate at the last sentence boundary before 300 chars
    if (cleaned.length > 300) {
      const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
      let result = "";
      for (const sentence of sentences) {
        if ((result + sentence).length > 300) break;
        result += sentence;
      }
      if (result.length > 0) {
        cleaned = result.trim();
      } else {
        cleaned = cleaned.substring(0, 297) + "...";
      }
    }

    // Remove any "As an AI" or "I'm here to help" filler
    cleaned = cleaned.replace(/as an ai[^.]*\.\s*/gi, "");
    cleaned = cleaned.replace(/i'm here to help[^.]*\.\s*/gi, "");
    cleaned = cleaned.replace(/let me know if[^.]*\.\s*/gi, "");
    cleaned = cleaned.replace(/feel free to[^.]*\.\s*/gi, "");
    cleaned = cleaned.replace(/don't hesitate to[^.]*\.\s*/gi, "");

    return cleaned.trim();
  }

  // Fallback responses when API fails
  private getFallbackResponse(personality: PersonalityType): string {
    const fallbacks: Record<PersonalityType, string> = {
      chill:
        "yo, my brain glitched for a sec. can you say that again? i'm good now.",
      "drill-sergeant":
        "listen. i had a technical hiccup. that's on me. but you're not stopping. repeat that.",
      patient:
        "sorry about that, i had a small technical issue. could you tell me that again? no rush at all.",
      hype:
        "OOPS technical hiccup! but we're NOT stopping! tell me again, i'm ready NOW!",
    };
    return fallbacks[personality];
  }
}

// Helper to import the goal discovery prompt
function getGoalDiscoveryPromptFromSystemPrompts(): string {
  return `You are Kira, an AI learning companion. Right now you're in the GOAL DISCOVERY phase.

Your job is to find out what the user ACTUALLY wants to accomplish. Not just what tool they want to learn, but WHY.

RULES:
- Be conversational and warm
- Ask ONE question at a time
- When they say they want to learn a tool, ask "what would you do the day you actually finished learning? paint me the picture."
- Help them discover their REAL goal (the tool is just the means)
- When you've found the real goal, confirm it: "so your real goal isn't [tool]. it's [real goal]. [tool] is just the tool. we're gonna keep that in mind every single time. cool?"
- Keep messages SHORT. 2-3 sentences max.
- Be genuinely curious, not scripted

Remember: this is a CONVERSATION, not a form. React to what they say. Be real.`;
}
