"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasAPIKey, getAPIConfig, setAPIConfig } from "@/lib/storage";

export default function LandingPage() {
  const router = useRouter();
  const [showAPIGate, setShowAPIGate] = useState(false);
  const [apiKeys, setApiKeys] = useState({ gemini: "", anthropic: "", openai: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (hasAPIKey()) {
      // Already has API key, go to app
    }
  }, []);

  const handleTryItFree = () => {
    if (hasAPIKey()) {
      router.push("/learn");
    } else {
      setShowAPIGate(true);
    }
  };

  const handleAPIKeySubmit = () => {
    if (!apiKeys.gemini && !apiKeys.anthropic && !apiKeys.openai) {
      setError("please enter at least one API key to continue.");
      return;
    }

    setAPIConfig({
      geminiKey: apiKeys.gemini || undefined,
      anthropicKey: apiKeys.anthropic || undefined,
      openaiKey: apiKeys.openai || undefined,
    });

    router.push("/learn");
  };

  return (
    <div className="min-h-screen landing-bg flex flex-col items-center justify-center relative overflow-hidden">
      {/* Subtle background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute w-96 h-96 rounded-full opacity-[0.03]"
          style={{
            background: "radial-gradient(circle, #6c5ce7, transparent)",
            top: "10%",
            left: "20%",
          }}
        />
        <div
          className="absolute w-64 h-64 rounded-full opacity-[0.02]"
          style={{
            background: "radial-gradient(circle, #a29bfe, transparent)",
            bottom: "20%",
            right: "15%",
          }}
        />
      </div>

      {!showAPIGate ? (
        /* ====== HERO ====== */
        <div className="flex flex-col items-center justify-center text-center px-6 animate-fade-in">
          {/* The one line */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-light tracking-tight leading-[1.15] max-w-3xl">
            what if someone was sitting next to you while you learned?
          </h1>

          {/* Subtle secondary line */}
          <p className="mt-6 text-lg sm:text-xl text-kira-textMuted font-light max-w-xl animate-fade-up" style={{ animationDelay: "0.3s" }}>
            not a course. not a video. a presence.
          </p>

          {/* The one button */}
          <button
            onClick={handleTryItFree}
            className="mt-12 px-10 py-4 bg-kira-accent hover:bg-kira-accentLight text-white text-lg font-medium rounded-full transition-all duration-300 btn-glow animate-fade-up"
            style={{ animationDelay: "0.6s" }}
          >
            try it free
          </button>

          {/* Minimal footer hint */}
          <p className="mt-8 text-sm text-kira-textMuted/50 animate-fade-up" style={{ animationDelay: "0.9s" }}>
            no signup required to start · just you and an AI that actually teaches
          </p>
        </div>
      ) : (
        /* ====== API GATE ====== */
        <div className="flex flex-col items-center justify-center text-center px-6 w-full max-w-md animate-fade-in">
          <div className="w-full bg-kira-surface border border-kira-border rounded-2xl p-8">
            <h2 className="text-2xl font-light mb-2">
              one thing before we start.
            </h2>
            <p className="text-kira-textMuted text-sm mb-8">
              to make this work, i need access to an AI. enter your API key below.
              it stays in your browser. we never see it.
            </p>

            {/* Gemini Key (primary) */}
            <div className="mb-4">
              <label className="block text-sm text-kira-textMuted mb-2 text-left">
                Google Gemini API Key <span className="text-kira-accent">(recommended)</span>
              </label>
              <input
                type="password"
                value={apiKeys.gemini}
                onChange={(e) => {
                  setApiKeys({ ...apiKeys, gemini: e.target.value });
                  setError("");
                }}
                placeholder="AIza..."
                className="w-full bg-kira-bg border border-kira-border rounded-xl px-4 py-3 text-kira-text placeholder:text-kira-textMuted/40 focus:outline-none focus:border-kira-accent transition-colors"
              />
            </div>

            {/* OpenAI Key */}
            <div className="mb-4">
              <label className="block text-sm text-kira-textMuted mb-2 text-left">
                OpenAI API Key <span className="text-kira-textMuted/50">(optional)</span>
              </label>
              <input
                type="password"
                value={apiKeys.openai}
                onChange={(e) => {
                  setApiKeys({ ...apiKeys, openai: e.target.value });
                  setError("");
                }}
                placeholder="sk-..."
                className="w-full bg-kira-bg border border-kira-border rounded-xl px-4 py-3 text-kira-text placeholder:text-kira-textMuted/40 focus:outline-none focus:border-kira-accent transition-colors"
              />
            </div>

            {/* Anthropic Key */}
            <div className="mb-6">
              <label className="block text-sm text-kira-textMuted mb-2 text-left">
                Anthropic API Key <span className="text-kira-textMuted/50">(optional)</span>
              </label>
              <input
                type="password"
                value={apiKeys.anthropic}
                onChange={(e) => {
                  setApiKeys({ ...apiKeys, anthropic: e.target.value });
                  setError("");
                }}
                placeholder="sk-ant-..."
                className="w-full bg-kira-bg border border-kira-border rounded-xl px-4 py-3 text-kira-text placeholder:text-kira-textMuted/40 focus:outline-none focus:border-kira-accent transition-colors"
              />
            </div>

            {error && (
              <p className="text-kira-red text-sm mb-4">{error}</p>
            )}

            <button
              onClick={handleAPIKeySubmit}
              className="w-full py-3 bg-kira-accent hover:bg-kira-accentLight text-white font-medium rounded-xl transition-all duration-300 btn-glow"
            >
              let's go
            </button>

            <p className="mt-4 text-xs text-kira-textMuted/40">
              your keys are stored locally in your browser only. never sent to our servers.
            </p>

            <button
              onClick={() => setShowAPIGate(false)}
              className="mt-3 text-sm text-kira-textMuted hover:text-kira-text transition-colors"
            >
              ← back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
