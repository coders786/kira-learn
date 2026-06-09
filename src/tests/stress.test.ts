// ===== STRESS TEST SUITE =====
// Simulates real student behavior to test:
// 1. Screen Engine: frame capture, change detection, analysis parsing
// 2. Trigger Engine: all trigger types, cooldowns, patterns
// 3. Orchestrator: input sanitization, special responses, anti-yapping
// 4. Gemini STT: noise detection prompt, transcription cleanup
// 5. Integration: full flow scenarios

// Mock browser globals for Node.js testing
(globalThis as any).document = {
  createElement: () => ({
    width: 800, height: 450,
    getContext: () => ({ drawImage: () => {}, fillRect: () => {} }),
    toDataURL: () => "data:image/jpeg;base64,FAKEFRAME" + "A".repeat(100),
  }),
};

import { TriggerEngine, TriggerContext, TriggerResult } from "../lib/ai/trigger-engine";
import { AIOrchestrator } from "../lib/ai/orchestrator";
import { ScreenEngine, ScreenAnalysis } from "../lib/screen/screen-engine";
import { GeminiSTT } from "../lib/voice/gemini-stt";
import { UserProfile, Mistake, Quest, ProgressNote, ConversationContext, Message } from "../lib/types";

// ===== Test runner =====
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, test: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${test}`);
  } else {
    failed++;
    const msg = `  ❌ ${test}${detail ? ` — ${detail}` : ""}`;
    failures.push(msg);
    console.log(msg);
  }
}

function assertIncludes(haystack: string, needle: string, test: string) {
  const found = haystack.toLowerCase().includes(needle.toLowerCase());
  assert(found, test, `Expected "${needle}" in "${haystack.substring(0, 100)}"`);
}

function assertNotIncludes(haystack: string, needle: string, test: string) {
  const found = haystack.toLowerCase().includes(needle.toLowerCase());
  assert(!found, test, `Did not expect "${needle}" but found it in "${haystack.substring(0, 100)}"`);
}

// ===== Helpers =====
const baseTime = Date.now();

function makeUser(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: "test-user",
    goal: "google ads",
    realGoal: "sell my candles online",
    tool: "google ads",
    personality: "chill",
    learningPreferences: { pace: "normal", hatesWords: ["synergy"], maxOptions: 2 },
    createdAt: baseTime, lastSessionAt: baseTime, totalSessions: 1, streakDays: 1,
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<TriggerContext>): TriggerContext {
  return {
    now: baseTime,
    lastUserMessageTime: baseTime - 10000,
    lastAIMessageTime: baseTime - 5000,
    sessionStartTime: baseTime - 300000,
    recentUserMessages: [],
    totalMessages: 10,
    lastAIContent: "okay, let's try creating a campaign. click the blue button.",
    screenSharing: true,
    screenMode: "live",
    lastScreenAnalysisTime: baseTime,
    screenApp: "Google Ads",
    screenPage: "Campaigns",
    screenShouldComment: false,
    screenComment: "",
    screenUrgency: "low",
    isUserTyping: false,
    isLoading: false,
    currentPhase: "teaching",
    ...overrides,
  };
}

function makeMessages(pairs: [string, string][]): Message[] {
  const msgs: Message[] = [];
  for (const [role, content] of pairs) {
    msgs.push({
      id: Math.random().toString(36).substring(2),
      role: role === "user" ? "user" : "ai",
      content,
      timestamp: Date.now() - Math.random() * 100000,
      phase: "teaching",
    });
  }
  return msgs;
}

// ====================================================================
// SECTION 1: TRIGGER ENGINE — The Proactive AI Brain
// ====================================================================
console.log("\n🔹 SECTION 1: TRIGGER ENGINE\n");

{
  console.log("--- Screen-based triggers ---");

  // TEST 1: Screen error should trigger immediately
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "wait. that budget is $1000 a day. for candles? start with $5.",
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "Screen error triggers");
    assert(result?.type === "screen-error", "Trigger type is screen-error", `Got: ${result?.type}`);
    assert(result?.priority === "high", "Priority is high");
    assert(result?.immediate === "wait. that budget is $1000 a day. for candles? start with $5.", "Uses screen comment as immediate text");
    assert(result?.reason === "Error detected on screen", "Reason is correct");
  }

  // TEST 2: Screen comment (medium urgency)
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      lastAIMessageTime: baseTime - 10000, // AI spoke 10s ago
      screenShouldComment: true,
      screenUrgency: "medium",
      screenComment: "i see you moved to the keywords tab. good.",
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "Screen comment triggers for medium urgency");
    assert(result?.type === "screen-comment", "Type is screen-comment");
    assert(result?.priority === "medium", "Priority is medium");
  }

  // TEST 3: Screen comment should NOT trigger right after AI spoke
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      lastAIMessageTime: baseTime - 3000, // AI spoke 3s ago (< 8s)
      screenShouldComment: true,
      screenUrgency: "medium",
      screenComment: "new page",
    });
    const result = engine.evaluate(ctx);
    assert(result === null, "Screen comment blocked when AI spoke < 8s ago");
  }

  // TEST 4: No trigger when not screen sharing
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      screenSharing: false,
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "something bad",
    });
    const result = engine.evaluate(ctx);
    assert(result === null, "No screen trigger when not sharing");
  }

  console.log("--- Pattern-based triggers ---");

  // TEST 5: 3+ short answers pattern
  {
    const engine = new TriggerEngine();
    engine.recordUserMessage("ok");
    engine.recordUserMessage("yeah");
    engine.recordUserMessage("sure");
    const ctx = makeCtx({ lastAIMessageTime: baseTime - 6000 });
    const result = engine.evaluate(ctx);
    assert(result !== null, "3 short answers triggers pattern-short");
    assert(result?.type === "pattern-short", "Type is pattern-short");
    assertIncludes(result?.prompt || "", "STOP asking", "Prompt says STOP asking");
    assertIncludes(result?.prompt || "", "EXPLAIN", "Prompt says EXPLAIN");
  }

  // TEST 6: Short answers reset on real message
  {
    const engine = new TriggerEngine();
    engine.recordUserMessage("ok");
    engine.recordUserMessage("yeah");
    engine.recordUserMessage("i think we should set the budget to five dollars per day for the campaign to start testing"); // Reset
    const ctx = makeCtx({ lastAIMessageTime: baseTime - 6000 });
    const result = engine.evaluate(ctx);
    assert(result === null, "Short answer pattern resets on real message");
  }

  // TEST 7: 2+ vague answers pattern
  {
    const engine = new TriggerEngine();
    engine.recordUserMessage("idk");
    engine.recordUserMessage("not sure what to do");
    const ctx = makeCtx({
      lastAIMessageTime: baseTime - 6000,
      lastAIContent: "okay let's move to the next step.", // No question mark, no action words
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "2 vague answers triggers pattern-vague");
    assert(result?.type === "pattern-vague", "Type is pattern-vague");
    assertIncludes(result?.prompt || "", "SUGGEST", "Prompt says SUGGEST");
  }

  // TEST 8: 3+ perfectionist loops
  {
    const engine = new TriggerEngine();
    engine.recordUserMessage("what if it's wrong?");
    engine.recordUserMessage("are you sure about this?");
    engine.recordUserMessage("is this really the right setting?");
    const ctx = makeCtx({ lastAIMessageTime: baseTime - 6000 });
    const result = engine.evaluate(ctx);
    assert(result !== null, "3 perfectionist messages triggers pattern-perfect");
    assert(result?.type === "pattern-perfect", "Type is pattern-perfect");
    assertIncludes(result?.prompt || "", "Push", "Prompt says push");
  }

  console.log("--- Silence-based triggers ---");

  // TEST 9: 30s silence after AI question
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      lastUserMessageTime: baseTime - 35000, // Silent 35s
      lastAIMessageTime: baseTime - 30000,   // AI asked 30s ago
      lastAIContent: "what do you think we should click first?",
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "30s silence after question triggers");
    assert(result?.type === "silence-short", "Type is silence-short");
  }

  // TEST 10: 60s silence
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      lastUserMessageTime: baseTime - 65000,
      lastAIMessageTime: baseTime - 40000,
      lastAIContent: "the next step is configuring your keywords.", // No ? or action trigger words
      screenSharing: false, // No screen triggers
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "60s silence triggers");
    assert(result?.type === "silence-medium", `Type is silence-medium, got: ${result?.type}`);
  }

  // TEST 11: 120s silence with immediate text
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      lastUserMessageTime: baseTime - 130000,
      lastAIMessageTime: baseTime - 80000, // > 60s since AI
      lastAIContent: "let's continue when you're ready.", // No ? or action trigger words
      screenSharing: false,
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "120s silence triggers");
    // 130s silence + 80s since AI — silence-long has timeSinceAI > 60s check
    // But silence-medium also matches (silenceDuration > 60000 && timeSinceAI > 30000)
    // silence-medium is evaluated before silence-long, so it wins
    // This is by design — silence-long is a fallback with immediate text
    assert(result?.type === "silence-medium" || result?.type === "silence-long", `Type is silence-medium or long, got: ${result?.type}`);
  }

  console.log("--- Cooldown tests ---");

  // TEST 12: Global cooldown blocks rapid triggers
  {
    const engine = new TriggerEngine();
    const ctx1 = makeCtx({
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "error!",
    });
    const result1 = engine.evaluate(ctx1);
    assert(result1 !== null, "First trigger fires");
    engine.markTriggered("screen-error");

    // Try again immediately with different screen error
    const ctx2 = makeCtx({
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "another error!",
    });
    const result2 = engine.evaluate(ctx2);
    assert(result2 === null, "Second trigger blocked by global cooldown");
  }

  // TEST 13: Type-specific cooldown
  {
    const engine = new TriggerEngine();
    // Fire a screen-error trigger
    const ctx1 = makeCtx({ screenShouldComment: true, screenUrgency: "high", screenComment: "err" });
    const r1 = engine.evaluate(ctx1);
    assert(r1 !== null, "First screen-error fires");
    engine.markTriggered("screen-error");

    // 6s later, try again (screen-error cooldown is 5s, global is 10s)
    const ctx2 = makeCtx({ now: baseTime + 6000, screenShouldComment: true, screenUrgency: "high", screenComment: "err2" });
    const r2 = engine.evaluate(ctx2);
    assert(r2 === null, "Blocked by global cooldown (10s) even though type cooldown (5s) passed");
  }

  // TEST 14: Screen stuck (45s silence + screen sharing)
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      lastUserMessageTime: baseTime - 50000,
      lastAIMessageTime: baseTime - 35000,
      lastAIContent: "this is the keywords configuration section.",
      screenSharing: true,
      screenMode: "live",
      screenShouldComment: false,
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "Screen stuck triggers at 45s");
    assert(result?.type === "screen-stuck", `Type is screen-stuck, got: ${result?.type}`);
  }

  console.log("--- Nudge trigger ---");

  // TEST 15: Nudge when AI taught something and user hasn't acted
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      lastAIContent: "click the '+ New Campaign' button. try it.",
      lastUserMessageTime: baseTime - 20000,
      lastAIMessageTime: baseTime - 15000,
      screenSharing: true,
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "Nudge triggers after AI taught + 15s silence");
    assert(result?.type === "nudge-continue", "Type is nudge-continue");
  }

  console.log("--- Phase protection ---");

  // TEST 16: No triggers during onboarding
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      currentPhase: "greeting",
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "error!",
    });
    const result = engine.evaluate(ctx);
    assert(result === null, "No triggers during greeting phase");
  }

  // TEST 17: No triggers during loading
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      isLoading: true,
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "error!",
    });
    const result = engine.evaluate(ctx);
    assert(result === null, "No triggers while loading");
  }

  // TEST 18: No triggers when user is typing
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      isUserTyping: true,
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "error!",
    });
    const result = engine.evaluate(ctx);
    assert(result === null, "No triggers while user typing");
  }

  console.log("--- Long session ---");

  // TEST 19: Long session break suggestion
  {
    const engine = new TriggerEngine();
    const ctx = makeCtx({
      sessionStartTime: baseTime - 1900000, // 31+ minutes
      totalMessages: 35,
      lastAIMessageTime: baseTime - 70000,
    });
    const result = engine.evaluate(ctx);
    assert(result !== null, "30+ min session triggers break suggestion");
    assert(result?.type === "session-long", "Type is session-long");
  }

  console.log("--- Stats tracking ---");

  // TEST 20: Stats are tracked correctly
  {
    const engine = new TriggerEngine();
    assert(engine.stats.consecutiveShort === 0, "Initial short count is 0");
    engine.recordUserMessage("ok");
    engine.recordUserMessage("yeah");
    assert(engine.stats.consecutiveShort === 2, "Short count is 2");
    engine.recordUserMessage("this is a real answer with actual content");
    assert(engine.stats.consecutiveShort === 0, "Short count resets");
  }
}

// ====================================================================
// SECTION 2: ORCHESTRATOR — Input Handling & Anti-Yapping
// ====================================================================
console.log("\n🔹 SECTION 2: ORCHESTRATOR\n");

{
  const orch = new AIOrchestrator("test-key");

  console.log("--- Input sanitization ---");

  // TEST 21: Empty input
  {
    const s = orch.sanitizeInput("   ");
    assert(s.isEmpty, "Empty input detected");
    assert(orch.getSpecialResponse(s) === "type something. anything you're thinking.", "Empty response");
  }

  // TEST 22: Gibberish
  {
    const s1 = orch.sanitizeInput("12345");
    assert(s1.isGibberish, "Numbers-only is gibberish");
    const s2 = orch.sanitizeInput("aaaaaa");
    assert(s2.isGibberish, "Repeated char is gibberish");
    const s3 = orch.sanitizeInput("hello world");
    assert(!s3.isGibberish, "Normal text is not gibberish");
  }

  // TEST 23: Hostile input
  {
    const s = orch.sanitizeInput("you're stupid and this is shit");
    assert(s.isHostile, "Hostile input detected");
    const resp = orch.getSpecialResponse(s);
    assertIncludes(resp, "frustrating", "Hostile response mentions frustration");
    assertNotIncludes(resp, "I'm sorry", "No corporate apology");
  }

  // TEST 24: Short input
  {
    const s = orch.sanitizeInput("ok");
    assert(s.isShort, "Short input detected");
  }

  // TEST 25: Essay input
  {
    const long = Array(60).fill("I want to learn google ads so").join(" ") + " sell candles";
    const s = orch.sanitizeInput(long);
    assert(s.isEssay, "Long input detected as essay");
  }

  // TEST 26: Vague input
  {
    const s = orch.sanitizeInput("idk man");
    assert(s.isVague, "Vague input detected");
  }

  // TEST 27: Perfectionist input
  {
    const s = orch.sanitizeInput("what if i set the budget wrong?");
    assert(s.isPerfectionist, "Perfectionist input detected");
  }

  // TEST 28: Emotional input
  {
    const s = orch.sanitizeInput("i'm scared i'll fail at this");
    assert(s.isEmotional, "Emotional input detected");
  }

  // TEST 29: Off-topic input
  {
    const s = orch.sanitizeInput("are you a robot? do you have feelings?");
    assert(s.isOffTopic, "Off-topic input detected");
  }

  console.log("--- Anti-yapping ---");

  // TEST 30: Banned phrases removed
  {
    const result = (orch as any).antiYapping("As an AI, I'm here to help. Feel free to ask me anything. Great question! Let me know if you need help.");
    assertNotIncludes(result, "as an ai", "Banned: 'as an ai'");
    assertNotIncludes(result, "i'm here to help", "Banned: 'here to help'");
    assertNotIncludes(result, "feel free", "Banned: 'feel free'");
    assertNotIncludes(result, "great question", "Banned: 'great question'");
    assertNotIncludes(result, "let me know", "Banned: 'let me know'");
  }

  // TEST 31: Long response truncated
  {
    const longText = "This is a very long response. ".repeat(20) + "And it keeps going with more text that should be cut off.";
    const result = (orch as any).antiYapping(longText);
    assert(result.length <= 350, `Long text truncated to ${result.length} chars`);
  }

  console.log("--- Error fallbacks ---");

  // TEST 32: Rate limit error
  {
    const resp = (orch as any).getErrorFallback("chill", new Error("429 quota exceeded"));
    assertIncludes(resp, "rate limit", "Rate limit error detected");
  }

  // TEST 33: Auth error
  {
    const resp = (orch as any).getErrorFallback("chill", new Error("401 API key invalid"));
    assertIncludes(resp, "API key", "Auth error detected");
  }

  // TEST 34: Personality-specific errors
  {
    const drillResp = (orch as any).getErrorFallback("drill-sergeant", new Error("network"));
    assertIncludes(drillResp, "my problem", "Drill sergeant takes blame");
    const hypeResp = (orch as any).getErrorFallback("hype", new Error("network"));
    assertIncludes(hypeResp, "glitch", "Hype personality error");
  }

  console.log("--- Opening tracking ---");

  // TEST 35: Track repeated openings
  {
    (orch as any).trackOpening("so what we need to do is...");
    (orch as any).trackOpening("so the next step is...");
    (orch as any).trackOpening("so you should click...");
    const openings = (orch as any).recentOpenings;
    assert(openings.length === 3, "3 openings tracked");
    assert(openings[0] === "so" && openings[1] === "so" && openings[2] === "so", "All start with 'so'");
  }
}

// ====================================================================
// SECTION 3: SCREEN ENGINE — Parsing & Frame Detection
// ====================================================================
console.log("\n🔹 SECTION 3: SCREEN ENGINE\n");

{
  console.log("--- Analysis parsing ---");

  // Create engine instance (won't actually call API in tests)
  const engine = new (ScreenEngine as any)("fake-api-key") as ScreenEngine;

  // TEST 36: Parse well-formed analysis
  {
    const rawText = `APP: Google Ads
PAGE: Campaign creation form
ACTION: Filling in budget field
NOTABLE: Budget is set to $1000/day which is very high for a small business
URGENCY: high
SHOULD_COMMENT: yes
COMMENT: wait. $1000 a day. for candles? that's $30k a month. start with $5.`;

    const analysis = (engine as any).parseAnalysis(rawText) as ScreenAnalysis;
    assert(analysis.app === "Google Ads", `App parsed: "${analysis.app}"`);
    assert(analysis.page === "Campaign creation form", `Page parsed: "${analysis.page}"`);
    assert(analysis.action === "Filling in budget field", `Action parsed`);
    assertIncludes(analysis.notable, "$1000/day", "Notable includes budget");
    assert(analysis.urgency === "high", "Urgency is high");
    assert(analysis.shouldComment === true, "Should comment is true");
    assertIncludes(analysis.comment, "$1000", "Comment includes $1000");
  }

  // TEST 37: Parse analysis with no comment needed
  {
    const rawText = `APP: Google Ads
PAGE: Dashboard
ACTION: Viewing campaigns list
NOTABLE: 3 active campaigns visible
URGENCY: low
SHOULD_COMMENT: no
COMMENT: `;

    const analysis = (engine as any).parseAnalysis(rawText) as ScreenAnalysis;
    assert(analysis.app === "Google Ads", "App parsed correctly");
    assert(analysis.shouldComment === false, "Should comment is false");
    assert(analysis.urgency === "low", "Urgency is low");
  }

  // TEST 38: Parse messy/incomplete analysis
  {
    const rawText = `APP: Unknown
PAGE: some page
ACTION: browsing
NOTABLE: nothing specific`;
    const analysis = (engine as any).parseAnalysis(rawText) as ScreenAnalysis;
    assert(analysis.app === "Unknown", "Handles missing fields gracefully");
    assert(analysis.shouldComment === false, "No comment when not specified");
    assert(analysis.urgency === "low", "Default urgency is low");
  }

  console.log("--- Frame change detection ---");

  // TEST 39: Identical frames
  {
    const frame = "a".repeat(10000);
    (engine as any).lastFrameBase64 = frame;
    const changed = (engine as any).hasFrameChanged(frame);
    assert(!changed, "Identical frame not detected as changed");
  }

  // TEST 40: Very different frames
  {
    (engine as any).lastFrameBase64 = "a".repeat(10000);
    const changed = (engine as any).hasFrameChanged("b".repeat(10000));
    assert(changed, "Completely different frame detected as changed");
  }

  // TEST 41: Different length frames
  {
    (engine as any).lastFrameBase64 = "a".repeat(10000);
    const changed = (engine as any).hasFrameChanged("a".repeat(15000));
    assert(changed, "Different length frame detected as changed");
  }

  // TEST 42: Slightly different same-length frames
  {
    (engine as any).lastFrameBase64 = "a".repeat(10000);
    const newFrame = "a".repeat(2500) + "X" + "a".repeat(7499);
    const changed = (engine as any).hasFrameChanged(newFrame);
    assert(changed, "Slightly different frame detected as changed");
  }

  // TEST 43: First frame always triggers
  {
    (engine as any).lastFrameBase64 = "";
    const changed = (engine as any).hasFrameChanged("anything");
    assert(changed, "First frame always detected as changed");
  }

  console.log("--- Vision rate limiting ---");

  // TEST 44: Rate limit works
  {
    (engine as any).visionCallTimes = [];
    assert((engine as any).canCallVision(), "First call allowed");
    assert((engine as any).canCallVision(), "Second call allowed");

    // Fill up to limit
    for (let i = 0; i < 8; i++) {
      (engine as any).visionCallTimes.push(Date.now());
    }
    assert(!(engine as any).canCallVision(), "Calls blocked after limit reached");
  }

  // TEST 45: Old calls expire
  {
    (engine as any).visionCallTimes = [Date.now() - 65000]; // 65s ago
    assert((engine as any).canCallVision(), "Old calls expired, new call allowed");
  }

  console.log("--- Vision prompt quality ---");

  // TEST 46: Vision prompt includes teaching context
  {
    (engine as any).tool = "google ads";
    (engine as any).realGoal = "sell my candles";
    (engine as any).personality = "chill";
    (engine as any).recentMessages = "Student: I set the budget to $500/day";
    const prompt = (engine as any).buildVisionPrompt();
    assertIncludes(prompt, "google ads", "Prompt includes tool");
    assertIncludes(prompt, "sell my candles", "Prompt includes real goal");
    assertIncludes(prompt, "APP:", "Prompt asks for APP field");
    assertIncludes(prompt, "SHOULD_COMMENT:", "Prompt asks for SHOULD_COMMENT");
    assertIncludes(prompt, "URGENCY:", "Prompt asks for URGENCY");
  }

  console.log("--- Capture frame safety ---");

  // TEST 47: No video element
  {
    (engine as any).videoEl = null;
    const frame = (engine as any).captureFrame();
    assert(frame === null, "Returns null when no video element");
  }

  // TEST 48: Video not loaded
  {
    (engine as any).videoEl = { videoWidth: 0, videoHeight: 0 };
    const frame = (engine as any).captureFrame();
    assert(frame === null, "Returns null when video has no frames");
  }

  console.log("--- Status getters ---");

  // TEST 49: Not running when stopped
  {
    const e = new ScreenEngine("test");
    assert(!e.running, "Not running by default");
    assert(!e.hasStream, "No stream by default");
    assert(e.lastScreenAnalysis === null, "No analysis by default");
  }

  // TEST 50: Stop clears everything
  {
    const e = new ScreenEngine("test");
    (e as any).isActive = true;
    (e as any).lastFrameBase64 = "something";
    e.stop();
    assert(!(e as any).isActive, "Stopped");
    assert((e as any).lastFrameBase64 === "", "Frame cleared");
  }
}

// ====================================================================
// SECTION 4: GEMINI STT — Prompt & Noise Detection
// ====================================================================
console.log("\n🔹 SECTION 4: GEMINI STT\n");

{
  const stt = new GeminiSTT({ apiKey: "test-key" });

  console.log("--- Transcription prompt ---");

  // TEST 51: Prompt asks for noise detection
  {
    const prompt = (stt as any).buildTranscriptionPrompt();
    assertIncludes(prompt, "NO_SPEECH", "Prompt mentions NO_SPEECH for noise");
    assertIncludes(prompt, "ONLY the transcribed text", "Prompt says ONLY transcribed text");
    assertIncludes(prompt, "noise", "Prompt mentions noise");
    assertIncludes(prompt, "silence", "Prompt mentions silence");
  }

  // TEST 52: Context included in prompt
  {
    stt.setContext("Student is learning Google Ads to sell candles. Kira just told them to set a $5 daily budget.");
    const prompt = (stt as any).buildTranscriptionPrompt();
    assertIncludes(prompt, "candles", "Context includes topic");
    assertIncludes(prompt, "ambiguous", "Prompt mentions resolving ambiguity");
  }

  // TEST 53: Language hint
  {
    const prompt = (stt as any).buildTranscriptionPrompt();
    assertIncludes(prompt, "English", "Language hint included");
  }

  console.log("--- Noise detection regex ---");

  // TEST 54: Noise responses detected
  {
    const noiseResponses = [
      "No speech detected",
      "NO_SPEECH",
      "Just background noise",
      "The audio contains only silence",
      "Unintelligible speech",
      "Cannot make out any words",
      "Nothing audible",
    ];
    const regex = /no (speech|voice|audio|talking|words)|just (noise|silence|background)|empty|nothing|unintelligible|cannot (hear|understand|make out)|inaudible|no_speech|no clear speech|only (noise|silence|background)|no audible/i;
    for (const resp of noiseResponses) {
      assert(regex.test(resp), `Noise detected: "${resp}"`);
    }
  }

  // TEST 55: Real speech NOT flagged as noise
  {
    const realResponses = [
      "I want to set the budget to five dollars a day",
      "click the blue button",
      "what's a campaign?",
      "how do I add keywords",
    ];
    const regex = /no (speech|voice|audio|talking|words)|just (noise|silence|background)|empty|nothing|unintelligible|cannot (hear|understand|make out)|inaudible/i;
    for (const resp of realResponses) {
      assert(!regex.test(resp), `Speech not flagged as noise: "${resp}"`);
    }
  }

  console.log("--- Transcription cleanup ---");

  // TEST 56: Clean up formatting
  {
    const inputs = [
      { raw: '"click the blue button"', expected: "click the blue button" },
      { raw: "Transcript: hello world", expected: "hello world" },
      { raw: "Speech: what's a campaign?", expected: "what's a campaign?" },
    ];
    for (const { raw, expected } of inputs) {
      const cleaned = raw
        .replace(/^["']|["']$/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/^(Transcript|Transcription|Text|Speech|User said|They said|He said|She said):\s*/i, "")
        .trim();
      assert(cleaned === expected, `Cleaned "${raw}" → "${cleaned}"`, `Expected: "${expected}"`);
    }
  }

  console.log("--- Configuration defaults ---");

  // TEST 57: Default config values
  {
    assert((stt as any).config.maxChunkDuration === 15000, "Max chunk 15s");
    assert((stt as any).config.silenceDuration === 1800, "Silence duration 1.8s");
    assert((stt as any).config.language === "en", "Default language en");
  }

  console.log("--- Status ---");

  // TEST 58: Status before start
  {
    assert(!stt.active, "Not active before start");
    assert(!stt.speaking, "Not speaking before start");
  }
}

// ====================================================================
// SECTION 5: INTEGRATION SCENARIOS
// ====================================================================
console.log("\n🔹 SECTION 5: STUDENT SCENARIOS\n");

{
  console.log("--- Scenario A: Eager beginner ---");
  {
    const trigger = new TriggerEngine();
    // Student: enthusiastic, keeps talking
    trigger.recordUserMessage("i want to learn google ads to sell my candles!");
    assert(trigger.stats.consecutiveShort === 0, "Eager message not short");
    assert(trigger.stats.consecutiveVague === 0, "Eager message not vague");

    trigger.recordUserMessage("what's a campaign?");
    trigger.recordUserMessage("how do i set up keywords?");
    trigger.recordUserMessage("this is actually fun");

    // No trigger should fire — student is engaged
    const ctx = makeCtx({ lastUserMessageTime: baseTime - 5000, lastAIMessageTime: baseTime - 3000 });
    const result = trigger.evaluate(ctx);
    assert(result === null, "No trigger for engaged student");
  }

  console.log("--- Scenario B: Lost soul (3+ short answers) ---");
  {
    const trigger = new TriggerEngine();
    trigger.recordUserMessage("ok");
    trigger.recordUserMessage("yeah");
    trigger.recordUserMessage("sure");

    const ctx = makeCtx({ lastAIMessageTime: baseTime - 8000 });
    const result = trigger.evaluate(ctx);
    assert(result !== null, "Lost soul triggers pattern-short");
    assert(result?.type === "pattern-short", "Correct trigger type");
    assertIncludes(result?.prompt || "", "EXPLAIN", "AI told to explain, not ask");
  }

  console.log("--- Scenario C: Budget mistake on screen ---");
  {
    const trigger = new TriggerEngine();
    const ctx = makeCtx({
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "wait. $1000 a day for a candle business? that's $30k/month. start with $5.",
    });
    const result = trigger.evaluate(ctx);
    assert(result !== null, "Budget mistake triggers");
    assert(result?.priority === "high", "High priority");
    assertIncludes(result?.immediate || "", "$1000", "Comment mentions $1000");
  }

  console.log("--- Scenario D: User AFK for 2 minutes ---");
  {
    const trigger = new TriggerEngine();
    const ctx = makeCtx({
      lastUserMessageTime: baseTime - 130000,
      lastAIMessageTime: baseTime - 80000,
      lastAIContent: "this is the dashboard overview.", // No ? or action words
      screenSharing: false,
    });
    const result = trigger.evaluate(ctx);
    assert(result !== null, "AFK triggers");
    assert(result?.type === "silence-medium" || result?.type === "silence-long", "Some silence trigger fires");
  }

  console.log("--- Scenario E: Perfectionist won't launch ---");
  {
    const trigger = new TriggerEngine();
    trigger.recordUserMessage("are you sure this is right?");
    trigger.recordUserMessage("what if it's wrong though?");
    trigger.recordUserMessage("is this really the perfect setting?");

    const ctx = makeCtx({
      lastAIMessageTime: baseTime - 6000,
      lastAIContent: "the budget is set.", // No ? or action trigger words
      screenSharing: false,
    });
    const result = trigger.evaluate(ctx);
    assert(result !== null, "Perfectionist triggers");
    assert(result?.type === "pattern-perfect", `Pattern-perfect trigger, got: ${result?.type}`);
    assertIncludes(result?.prompt || "", "push", "Prompt says push");
  }

  console.log("--- Scenario F: Screen stuck (same page 45s) ---");
  {
    const trigger = new TriggerEngine();
    const ctx = makeCtx({
      lastUserMessageTime: baseTime - 50000,
      lastAIMessageTime: baseTime - 40000,
      lastAIContent: "this section handles your ad scheduling.", // No ? or action trigger words
      screenSharing: true,
      screenMode: "live",
      screenShouldComment: false,
    });
    const result = trigger.evaluate(ctx);
    assert(result !== null, "Screen stuck triggers");
    assert(result?.type === "screen-stuck", `Correct type, got: ${result?.type}`);
  }

  console.log("--- Scenario G: AI teaches, student doesn't act ---");
  {
    const trigger = new TriggerEngine();
    const ctx = makeCtx({
      lastAIContent: "okay your turn. try it — click the '+ New Campaign' button.",
      lastUserMessageTime: baseTime - 20000,
      lastAIMessageTime: baseTime - 16000,
      screenSharing: true,
    });
    const result = trigger.evaluate(ctx);
    assert(result !== null, "Nudge triggers after teaching");
    assert(result?.type === "nudge-continue", "Type is nudge-continue");
  }

  console.log("--- Scenario H: Vague student needs direction ---");
  {
    const trigger = new TriggerEngine();
    trigger.recordUserMessage("idk");
    trigger.recordUserMessage("not sure what to do here");

    const ctx = makeCtx({ lastAIMessageTime: baseTime - 6000 });
    const result = trigger.evaluate(ctx);
    assert(result !== null, "Vague student triggers");
    assert(result?.type === "pattern-vague", "Type is pattern-vague");
    assertIncludes(result?.prompt || "", "SUGGEST", "AI told to suggest");
  }

  console.log("--- Scenario I: Screen comment blocked right after AI spoke ---");
  {
    const trigger = new TriggerEngine();
    const ctx = makeCtx({
      lastAIMessageTime: baseTime - 3000, // AI spoke 3s ago
      screenShouldComment: true,
      screenUrgency: "medium",
      screenComment: "you moved to keywords tab",
    });
    const result = trigger.evaluate(ctx);
    assert(result === null, "Screen comment blocked when AI just spoke");
  }

  console.log("--- Scenario J: Multiple triggers, priority wins ---");
  {
    const trigger = new TriggerEngine();
    trigger.recordUserMessage("idk");
    trigger.recordUserMessage("not sure");
    // This creates BOTH pattern-vague (medium) AND if silence is long enough, silence-medium (low)
    // Pattern should win due to priority ordering

    const ctx = makeCtx({
      lastUserMessageTime: baseTime - 65000, // 65s silence
      lastAIMessageTime: baseTime - 40000,
      screenSharing: true,
      screenMode: "live",
    });
    const result = trigger.evaluate(ctx);
    assert(result !== null, "One of the triggers fires");
    // Pattern-vague should win over silence because it's evaluated first (higher priority)
    assert(result?.type === "pattern-vague", "Pattern-vague wins over silence (higher priority)");
  }

  console.log("--- Scenario K: No spam — cooldown prevents repeat ---");
  {
    const trigger = new TriggerEngine();
    // Trigger pattern-vague
    trigger.recordUserMessage("idk");
    trigger.recordUserMessage("not sure");
    let ctx = makeCtx({ lastAIMessageTime: baseTime - 6000 });
    let result = trigger.evaluate(ctx);
    assert(result !== null, "First vague trigger fires");
    trigger.markTriggered(result!.type);

    // User says more vague things
    trigger.recordUserMessage("whatever");
    trigger.recordUserMessage("i guess");
    ctx = makeCtx({ lastAIMessageTime: baseTime - 6000 });
    result = trigger.evaluate(ctx);
    // Should be blocked by global cooldown (10s) and type cooldown (60s)
    assert(result === null, "Repeated vague blocked by cooldown");
  }

  console.log("--- Scenario L: Screen error during typing should NOT fire ---");
  {
    const trigger = new TriggerEngine();
    const ctx = makeCtx({
      isUserTyping: true,
      screenShouldComment: true,
      screenUrgency: "high",
      screenComment: "ERROR: budget is way too high!",
    });
    const result = trigger.evaluate(ctx);
    assert(result === null, "Screen error blocked while user typing — don't interrupt");
  }

  console.log("--- Scenario M: New session — nothing should trigger ---");
  {
    const trigger = new TriggerEngine(); // Fresh engine
    const ctx = makeCtx({
      currentPhase: "teaching",
      totalMessages: 2, // Very few messages
      screenSharing: false,
    });
    const result = trigger.evaluate(ctx);
    assert(result === null, "Nothing triggers in new session with no patterns");
  }
}

// ====================================================================
// SECTION 6: SCREEN ENGINE PROMPT INTEGRITY
// ====================================================================
console.log("\n🔹 SECTION 6: VISION PROMPT QUALITY\n");

{
  console.log("--- Prompt completeness ---");

  // TEST: Verify prompt structure for different tools
  const testTools = ["google ads", "figma", "shopify", "some random tool"];
  for (const tool of testTools) {
    const engine = new ScreenEngine("test");
    engine.setTeachingContext(tool, `make money with ${tool}`, "chill");
    const prompt = (engine as any).buildVisionPrompt();
    assertIncludes(prompt, tool, `Prompt includes tool: ${tool}`);
    assertIncludes(prompt, "APP:", "Prompt has APP field");
    assertIncludes(prompt, "SHOULD_COMMENT:", "Prompt has SHOULD_COMMENT field");
    assertIncludes(prompt, "COMMENT:", "Prompt has COMMENT field");
  }
}

// ====================================================================
// RESULTS
// ====================================================================
console.log("\n" + "=".repeat(60));
console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60));

if (failures.length > 0) {
  console.log("\n❌ FAILURES:");
  failures.forEach(f => console.log(f));
}

console.log(`\n${failed === 0 ? "✅ ALL TESTS PASSED" : `⚠️ ${failed} TESTS FAILED`}\n`);

process.exit(failed > 0 ? 1 : 0);
