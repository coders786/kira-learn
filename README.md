# Kira — The teacher you always wished you had

> _"What if someone was sitting next to you while you learned?"_

Not a course. Not a video. Not a tutorial. A presence.

Kira is an AI learning companion that sits next to you while you learn any tool or skill. It watches your screen, talks to you like a friend, and teaches you using the Socratic method — asking questions, making you think, and celebrating your wins.

## ✨ What makes Kira different

- **Conversational, not courses** — No videos. No slides. Just a real conversation.
- **Socratic method** — Kira asks YOU questions. Makes you think. That's how you remember.
- **Screen sharing** — Kira watches your screen and guides you in real-time.
- **Personality matching** — Pick from 4 teaching personalities: chill, drill sergeant, patient, or hype.
- **Your examples, not generic ones** — Learning Google Ads for your candle business? Every example is about candles.
- **Mistake bank** — Track mistakes, learn from them, never repeat them.
- **Voice-first** — Speak or type. Kira talks back.
- **Adaptive mood** — Kira matches your energy. Fast when you're in the zone, patient when you're slow.
- **Daily quests** — One tiny thing per day. Small. Doable. Momentum.

## 🏗️ Architecture

```
kira-learn/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Landing page (the emotional hook)
│   │   ├── learn/page.tsx      # Main learning interface
│   │   └── api/                # Backend API routes
│   │       ├── chat/route.ts   # AI conversation endpoint
│   │       └── screen/route.ts # Screen analysis endpoint
│   ├── components/             # UI components
│   │   └── app/                # App-specific components
│   ├── hooks/                  # React hooks
│   │   ├── useConversation.ts  # Conversation state management
│   │   ├── useScreenShare.ts   # Screen capture & sharing
│   │   └── useVoice.ts         # Speech-to-text & text-to-speech
│   └── lib/                    # Core logic
│       ├── ai/                 # AI orchestration layer
│       │   ├── orchestrator.ts # Central AI brain
│       │   └── system-prompts.ts # Personality & teaching prompts
│       ├── storage/            # Local storage management
│       └── types.ts            # TypeScript type definitions
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- A Google Gemini API key ([get one here](https://aistudio.google.com/apikey))

### Installation

```bash
# Clone the repo
git clone https://github.com/kira-shin/kira-learn.git
cd kira-learn

# Install dependencies
npm install

# Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter your Gemini API key when prompted.

## 🧠 Core Systems

### 1. The Conversation Engine
The heart of Kira. Uses Gemini 2.0 Flash for fast, natural responses. Every message is:
- **Short** — Max 3-4 sentences. Anti-yapping enforced.
- **Socratic** — Asks questions instead of lecturing.
- **Personalized** — Every example relates to YOUR real goal.
- **Contextual** — Knows your mood, your mistakes, your progress.

### 2. The Screen Sharing System
Uses the browser's Screen Capture API + Gemini's vision capabilities:
- Low-framerate capture (1 FPS) to stay lightweight
- AI analyzes what's on screen and guides you
- No data stored — just look, help, forget
- User can stop sharing anytime

### 3. The Personality System
Four distinct teaching personalities:
| Personality | Style |
|---|---|
| 🌊 The Chill One | Casual, jokes, never pushy |
| 💪 The Drill Sergeant | Hard love, no excuses, actually cares |
| 🌿 The Patient One | Slow, repeats, never annoyed |
| 🔥 The Hype One | Celebrates every tiny win |

Each personality changes:
- The AI's system prompt
- The voice synthesis parameters (rate, pitch)
- The conversation style forever

### 4. The Mistake Bank
Every mistake is caught, categorized, and tracked:
- Top 5 most common mistakes
- "Want to spend 10 minutes making sure you never do this again?"
- Mistakes become teaching moments

### 5. The Mood Detection System
Kira adapts to your energy level:
- **In the zone** → Speeds up, skips basics
- **Normal** → Standard pace
- **Slow** → More patient, repeats concepts
- **Tired** → Suggests shorter sessions, offers breaks

## 🛡️ Privacy

- All user data is stored locally in the browser (prototype)
- API keys never leave your browser
- Screen data is processed in real-time and never stored
- No accounts, no tracking, no analytics (in prototype)

## 📋 Free vs Pro (Planned)

| Feature | Free | Pro |
|---|---|---|
| Sessions per week | 3 | Unlimited |
| Tools | 1 | All |
| AI memory | 7 days | Forever |
| Personality | Default | Pick any |
| Mistake bank | ❌ | ✅ |
| Morning texts | ❌ | ✅ |
| Daily quests | ❌ | ✅ |
| Community rooms | ❌ | ✅ |

## 🛣️ Roadmap

- [ ] Persistent cloud storage for user profiles
- [ ] Multi-model support (Claude, GPT-4, etc.)
- [ ] Community rooms (20 people, same goal)
- [ ] Morning text notifications
- [ ] Mobile-responsive design
- [ ] More personality customization
- [ ] Tool-specific teaching modules
- [ ] Progress analytics (conversational, not charts)
- [ ] Achievement system (without feeling gamified)

## 💡 The Vision

> _The user outgrows the AI. The AI becomes a memory. A friend who got you there._

The end state isn't a user who uses Kira forever. It's a user who opens the app one day and says "I'm the teacher now." That's success.

## 📄 License

MIT

---

Built with Next.js, Gemini AI, and the belief that everyone deserves a teacher who actually sees them.
