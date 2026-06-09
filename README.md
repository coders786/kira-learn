# Kira — The teacher you always wished you had

> _"What if someone was sitting next to you while you learned?"_

**Not a course. Not a video. A presence.**

Kira is an AI learning companion that sits next to you while you learn any tool or skill. It watches your screen, talks to you like a friend, and teaches using the Socratic method — asking questions, making you think, and celebrating your wins.

🌐 **Live on GitHub:** [coders786/kira-learn](https://github.com/coders786/kira-learn)

---

## ✨ What makes Kira different

| Feature | How it works |
|---|---|
| **Conversational** | Not courses. Not videos. Just a real conversation. |
| **Socratic method** | Kira asks YOU questions. Makes you think. That's how you remember. |
| **Screen sharing** | Watches your screen and guides you in real-time via Gemini Vision. |
| **Personality matching** | 4 personalities: chill 🌊, drill sergeant 💪, patient 🌿, hype 🔥 |
| **Your examples** | Learning Google Ads for candles? Every example is about YOUR candles. |
| **Mistake bank** | Tracks mistakes, teaches from them, you never repeat them. |
| **Voice-first** | Speak or type. Kira talks back with personality-matched voice. |
| **Adaptive mood** | Matches your energy — fast when you're in the zone, patient when you're slow. |
| **Daily quests** | One tiny thing per day. Small. Doable. Momentum. |
| **Anti-yapping** | Responses are SHORT. 2-4 sentences max. Always. |
| **Context triggers** | Detects confusion, silence, energy levels and responds proactively. |

---

## 🏗️ Architecture

```
kira-learn/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Landing page (the emotional hook)
│   │   ├── learn/page.tsx           # Main learning interface
│   │   └── api/
│   │       ├── chat/route.ts        # AI conversation endpoint (Gemini)
│   │       └── screen/route.ts      # Screen vision analysis (Gemini)
│   ├── components/app/
│   │   ├── Conversation.tsx         # Chat message display
│   │   ├── PersonalityPicker.tsx    # 4 personality cards
│   │   ├── ScreenSharePanel.tsx     # Live screen preview
│   │   ├── MistakeBank.tsx          # Mistake tracking overlay
│   │   ├── DailyQuest.tsx           # Micro-learning quest
│   │   └── Sidebar.tsx              # Navigation sidebar
│   ├── hooks/
│   │   ├── useConversation.ts       # Conversation state machine
│   │   ├── useScreenShare.ts        # Screen capture (WebRTC)
│   │   └── useVoice.ts             # Speech-to-text + text-to-speech
│   └── lib/
│       ├── ai/
│       │   ├── orchestrator.ts      # Central AI brain (Gemini 2.0 Flash)
│       │   ├── system-prompts.ts    # Personality & Socratic prompts
│       │   ├── context-triggers.ts  # Behavioral trigger detection
│       │   ├── teaching-engine.ts   # Topic progression & testing
│       │   └── engagement.ts        # Morning texts & community
│       ├── storage/index.ts         # Local-first data persistence
│       └── types.ts                 # Full TypeScript type system
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- A Google Gemini API key → [Get one free](https://aistudio.google.com/apikey)

### Install & Run

```bash
git clone https://github.com/coders786/kira-learn.git
cd kira-learn
npm install
npm run dev
```

Open **http://localhost:3000** → Click "try it free" → Enter your Gemini API key → Start learning.

---

## 🧠 Core Systems

### 1. The Conversation Engine
Uses **Gemini 2.0 Flash** for fast, natural responses.

Every AI message is:
- **Short** — Max 3-4 sentences. Anti-yapping enforced at code level.
- **Socratic** — Asks questions instead of lecturing.
- **Personalized** — Every example ties to YOUR real goal.
- **Contextual** — Knows your mood, mistakes, progress, and screen state.

The orchestrator injects context into every prompt:
- Active mistakes to watch for
- Recent progress observations
- Detected user mood
- Current teaching topic
- Screen share status

### 2. The Screen Sharing System
Browser Screen Capture API + Gemini Vision:

- Low-framerate capture (1 FPS base, 15s auto-analysis intervals)
- AI analyzes what's on screen and guides contextually
- No data stored — look, help, forget
- User can stop sharing anytime
- Inline preview shows exactly what the AI sees

### 3. The Personality System
Four distinct teaching personalities, each with:

| Personality | Voice Rate | Voice Pitch | Prompt Style |
|---|---|---|---|
| 🌊 Chill | 0.95x | 1.0 | Slang, "no worries", jokes |
| 💪 Drill Sergeant | 1.1x | 0.9 | Direct, "listen", "here's the deal" |
| 🌿 Patient | 0.8x | 1.05 | Gentle, "take your time", repeats |
| 🔥 Hype | 1.15x | 1.2 | "YESSS!", celebrations, energy |

Each personality changes:
- The AI's system prompt (core behavior)
- The TTS voice parameters (how it sounds)
- The conversation pattern forever

### 4. The Teaching Engine
Manages what to teach, when to test, and how to celebrate:

- **Tool-specific sequences** for Google Ads, Figma, Shopify
- **Auto-testing** every 7 exchanges ("explain in your own words...")
- **Mistake interception** — Stops users before common errors
- **Win detection** — Celebrates first sales, breakthroughs
- **Topic progression** — Moves forward when understanding is demonstrated

### 5. The Context Trigger System
Detects when to proactively respond based on:

| Signal | Response |
|---|---|
| 2+ min silence | "you still there? no rush." |
| 3+ short answers | "want me to explain that again?" |
| 30+ min session | "want to take a break?" |
| Screen change | "i see you moved to a new page." |
| Confusion words | Slow down, simplify |
| High energy | Speed up, skip basics |

### 6. The Mistake Bank
Every mistake is caught, categorized, and tracked:

- Top 5 most common mistakes displayed
- "Want to spend 10 min making sure you never do this again?"
- Mistakes become teaching moments
- Resolved mistakes build confidence

---

## 🛡️ Privacy

- All data stored locally in browser (localStorage)
- API keys never leave your browser
- Screen data processed in real-time, never stored
- No accounts, no tracking, no analytics
- Open source — you can verify everything

---

## 🛣️ Roadmap

- [ ] Cloud sync for user profiles across devices
- [ ] Multi-model support (Claude, GPT-4, Kimi, GLM)
- [ ] Community rooms (20 people, same goal, real-time)
- [ ] Morning push notifications (PWA)
- [ ] Mobile app (React Native)
- [ ] More tool-specific teaching modules
- [ ] Learning analytics (conversational, not charts)
- [ ] Real-time collaborative screen sharing
- [ ] Tool calling for hands-on actions
- [ ] Background intent detection (advanced dictation)
- [ ] Persistent memory across sessions (vector store)

---

## 💡 The Vision

> _The user outgrows the AI. The AI becomes a memory. A friend who got you there._

The end state isn't a user who uses Kira forever. It's a user who opens the app one day and the AI says:

**"you tell me. you're the teacher now."**

That's success.

---

## 📄 License

MIT

---

Built with **Next.js 15**, **Gemini 2.0 Flash**, **Tailwind CSS**, and the belief that everyone deserves a teacher who actually sees them.

*By Kira Shin*
