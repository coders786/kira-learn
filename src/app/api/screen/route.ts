import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageData, prompt, apiKey, tool, goal } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key required" },
        { status: 401 }
      );
    }

    if (!imageData) {
      return NextResponse.json(
        { error: "Screen image data required" },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 200,
      },
    });

    const analysisPrompt = `You are Kira, an AI learning companion. You're looking at the user's screen while they learn ${tool || "a tool"} to achieve their goal of ${goal || "building something"}.

Look at the screen and provide a brief, helpful analysis:
1. What page/section are they on?
2. What should they do next?
3. Any mistakes you notice?

Keep it SHORT. 2-3 sentences max. Speak casually, like a friend sitting next to them. Use lowercase often.`;

    const result = await model.generateContent([
      analysisPrompt,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageData,
        },
      },
    ]);

    const response = result.response.text();

    return NextResponse.json({ response: response.trim() });
  } catch (error: any) {
    console.error("Screen API error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
