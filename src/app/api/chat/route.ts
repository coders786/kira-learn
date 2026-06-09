import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      message,
      history = [],
      systemPrompt,
      apiKey,
      maxTokens = 300,
    } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key required" },
        { status: 401 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: "Message required" },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.85,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: maxTokens,
      },
    });

    // Build conversation history
    const geminiHistory = history.map((msg: any) => ({
      role: msg.role === "ai" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: systemPrompt }],
        },
        {
          role: "model",
          parts: [
            {
              text: "got it. i'm kira. i know who i am, i know who they are, and i know how to teach. let's go.",
            },
          ],
        },
        ...geminiHistory,
      ],
    });

    const result = await chat.sendMessage(message);
    const response = result.response.text();

    // Anti-yapping: truncate if too long
    let cleaned = response.trim();
    if (cleaned.length > 400) {
      const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
      let truncated = "";
      for (const sentence of sentences) {
        if ((truncated + sentence).length > 350) break;
        truncated += sentence;
      }
      cleaned = truncated || cleaned.substring(0, 350) + "...";
    }

    // Remove AI disclaimers
    cleaned = cleaned
      .replace(/as an ai[^.]*\.\s*/gi, "")
      .replace(/i'm here to help[^.]*\.\s*/gi, "")
      .replace(/feel free to[^.]*\.\s*/gi, "");

    return NextResponse.json({ response: cleaned.trim() });
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
