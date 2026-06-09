// ===== Morning Text System =====
// Generates a single, personal morning check-in message
// Like a text from a friend, not a push notification

import { UserProfile, Mistake, ProgressNote, Quest } from "../types";

export interface MorningTextContext {
  user: UserProfile;
  recentTopic: string;
  streakDays: number;
  activeMistakes: Mistake[];
  recentProgress: ProgressNote[];
  yesterdayQuest?: Quest;
  daysSinceLastSession: number;
}

export function generateMorningText(ctx: MorningTextContext): string {
  const { user, recentTopic, streakDays, daysSinceLastSession } = ctx;

  // User hasn't been active in a while
  if (daysSinceLastSession >= 3) {
    const reengagementTexts = [
      `no pressure. just checking in. the ${user.realGoal} aren't going anywhere. we'll be here when you're back.`,
      `hey. it's been a few days. that's fine. whenever you're ready, i'm here.`,
      `just a thought. you were learning about ${recentTopic || user.tool}. want to pick that up today? no rush.`,
    ];
    return pickRandom(reengagementTexts);
  }

  // User has a streak going
  if (streakDays >= 7) {
    const streakTexts = [
      `${streakDays} days straight. that's not nothing. want to make it ${streakDays + 1}? takes like 20 min.`,
      `you've been showing up for ${streakDays} days. that's more than most people do in a month. today's session is about ${recentTopic || "the next thing"}. you in?`,
    ];
    return pickRandom(streakTexts);
  }

  // Standard check-in
  const standardTexts = [
    `hey. you were learning about ${recentTopic || user.tool} yesterday. want to pick that up today? takes like 20 min.`,
    `just a thought. ${user.realGoal} — that's still the goal, right? i've got something small for you today if you're up for it.`,
    `morning. quick thing — want to spend 15 min on ${user.tool} today? i promise it'll be worth it.`,
    `hey. i was thinking about what you learned yesterday. there's a natural next step. want me to walk you through it?`,
  ];
  return pickRandom(standardTexts);
}

// ===== Community Message Generator =====
// Simulates community room messages for the prototype
export function generateCommunityMessage(
  userName: string,
  userGoal: string,
  userTool: string
): { author: string; content: string; type: "question" | "celebration" | "help" | "general" } {
  const communityMembers = [
    { name: "sarah", personality: "encouraging" },
    { name: "mike", personality: "curious" },
    { name: "jordan", personality: "helpful" },
    { name: "alex", personality: "chill" },
  ];

  const templates = {
    question: [
      `has anyone figured out ${userTool} ${["bidding", "keywords", "audiences", "budgeting"][Math.floor(Math.random() * 4)]} yet? i'm stuck.`,
      `quick question — when you set up your first campaign, did you use maximize clicks or manual cpc?`,
      `can someone explain ${userTool} match types to me like i'm 5? 😅`,
    ],
    celebration: [
      `just made my first sale from ${userTool}!! 🎉`,
      `finally got my quality score above 7! took 3 weeks but we got there.`,
      `my ${userGoal} campaign just hit break-even. it's working!`,
    ],
    help: [
      `@${userName} — you've been crushing it this week. you should share your setup.`,
      `anyone want to do a co-working session? just sitting here working on our ${userTool} stuff together.`,
      `i found a great negative keyword list for ${userGoal} businesses. want me to share it?`,
    ],
    general: [
      `day 12 of learning ${userTool}. still confused but less confused than day 1 😂`,
      `anyone else learning at night? somehow this stuff clicks better at 11pm.`,
      `this room is quiet today. everyone out there actually applying what they learned?`,
    ],
  };

  const types: Array<"question" | "celebration" | "help" | "general"> = [
    "question", "celebration", "help", "general",
  ];
  const type = types[Math.floor(Math.random() * types.length)];
  const member = communityMembers[Math.floor(Math.random() * communityMembers.length)];
  const content = pickRandom(templates[type]);

  return { author: member.name, content, type };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
