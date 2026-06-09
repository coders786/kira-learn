// ===== Teaching Engine =====
// Manages the teaching logic: what to teach next, when to test,
// when to stop the user, and how to celebrate wins

import { Mistake, Quest, ProgressNote, UserProfile } from "../types";

export interface TeachingPlan {
  currentTopic: string;
  nextTopic: string;
  topicsCompleted: string[];
  lastTestedAt: number;
  mistakesToReview: Mistake[];
  shouldTest: boolean;
  shouldStopUser: boolean;
  stopReason?: string;
  shouldCelebrate: boolean;
  celebrationReason?: string;
  messageCountSinceLastTest: number;
}

// Tool-specific teaching sequences
const TEACHING_SEQUENCES: Record<string, string[]> = {
  "google ads": [
    "understanding the three levels (campaigns, ad groups, keywords)",
    "creating your first campaign",
    "setting daily budget correctly",
    "understanding bidding strategies (maximize clicks vs conversions)",
    "building your first ad group",
    "writing ad copy that converts",
    "choosing the right keywords",
    "understanding match types (exact, phrase, broad)",
    "setting up negative keywords",
    "adding audiences and demographics",
    "understanding quality score",
    "reading your first results",
    "optimizing based on data",
    "scaling what works",
    "a/b testing your ads",
  ],
  figma: [
    "understanding the interface (toolbar, layers, properties)",
    "creating your first frame",
    "working with shapes",
    "using text layers",
    "understanding auto-layout",
    "creating components",
    "using variants",
    "building a design system",
    "prototyping interactions",
    "sharing and collaborating",
    "exporting assets",
    "plugins and extensions",
  ],
  shopify: [
    "understanding the admin dashboard",
    "setting up your store",
    "adding products",
    "organizing collections",
    "choosing and customizing a theme",
    "setting up payment providers",
    "configuring shipping",
    "creating discount codes",
    "understanding analytics",
    "setting up email marketing",
    "managing orders",
    "handling customer service",
  ],
  default: [
    "understanding the interface",
    "basic operations",
    "creating your first project",
    "understanding key features",
    "intermediate operations",
    "advanced features",
    "best practices",
    "troubleshooting common issues",
    "optimization techniques",
    "real-world application",
  ],
};

export class TeachingEngine {
  private plan: TeachingPlan;
  private user: UserProfile;
  private messageCount = 0;

  constructor(user: UserProfile) {
    this.user = user;
    const sequence = this.getTeachingSequence();
    this.plan = {
      currentTopic: sequence[0],
      nextTopic: sequence[1] || sequence[0],
      topicsCompleted: [],
      lastTestedAt: 0,
      mistakesToReview: [],
      shouldTest: false,
      shouldStopUser: false,
      shouldCelebrate: false,
      messageCountSinceLastTest: 0,
    };
  }

  private getTeachingSequence(): string[] {
    const toolKey = Object.keys(TEACHING_SEQUENCES).find((key) =>
      this.user.tool.toLowerCase().includes(key)
    );
    return toolKey ? TEACHING_SEQUENCES[toolKey] : TEACHING_SEQUENCES.default;
  }

  // Call this on every new exchange
  update(
    userMessage: string,
    mistakes: Mistake[],
    quests: Quest[],
    progress: ProgressNote[]
  ): TeachingPlan {
    this.messageCount++;
    this.plan.messageCountSinceLastTest++;

    // Check if we should test understanding (every 6-8 exchanges)
    this.plan.shouldTest = this.plan.messageCountSinceLastTest >= 7;

    // Check if we should stop the user before a mistake
    this.plan.shouldStopUser = this.detectImpendingMistake(userMessage);
    this.plan.mistakesToReview = mistakes.filter((m) => !m.resolved).slice(0, 3);

    // Check if we should celebrate
    this.plan.shouldCelebrate = this.detectWin(userMessage, quests, progress);
    if (this.plan.shouldCelebrate) {
      this.plan.celebrationReason = this.getCelebrationReason(userMessage);
    }

    // Mark topic as completed if user demonstrates understanding
    if (this.detectTopicCompletion(userMessage)) {
      this.plan.topicsCompleted.push(this.plan.currentTopic);
      const sequence = this.getTeachingSequence();
      const nextIndex =
        sequence.indexOf(this.plan.currentTopic) + 1;
      if (nextIndex < sequence.length) {
        this.plan.currentTopic = sequence[nextIndex];
        this.plan.nextTopic = sequence[nextIndex + 1] || this.plan.currentTopic;
      }
    }

    return { ...this.plan };
  }

  private detectImpendingMistake(userMessage: string): boolean {
    const lower = userMessage.toLowerCase();

    // Detect budget-related mistakes
    if (/budget.*\d{3,}/i.test(userMessage) || /500|1000|5000/.test(userMessage)) {
      this.plan.stopReason = "high_budget";
      return true;
    }

    // Detect "maximize conversions" when they have no data
    if (
      lower.includes("maximize conversions") &&
      !this.plan.topicsCompleted.includes(
        "understanding bidding strategies (maximize clicks vs conversions)"
      )
    ) {
      this.plan.stopReason = "maximize_conversions_early";
      return true;
    }

    return false;
  }

  private detectWin(
    userMessage: string,
    quests: Quest[],
    progress: ProgressNote[]
  ): boolean {
    const lower = userMessage.toLowerCase();

    // Win signals
    if (
      /first sale|made a sale|got a customer|someone bought/.test(lower) ||
      /it worked|that actually worked|i did it/.test(lower) ||
      (quests.some((q) => q.completed) &&
        progress.length > 0 &&
        progress[progress.length - 1].timestamp > Date.now() - 60000)
    ) {
      return true;
    }

    return false;
  }

  private getCelebrationReason(userMessage: string): string {
    if (/first sale|made a sale|got a customer|someone bought/.test(userMessage.toLowerCase())) {
      return "first_sale";
    }
    if (/it worked|that actually worked|i did it/.test(userMessage.toLowerCase())) {
      return "something_worked";
    }
    return "general_win";
  }

  private detectTopicCompletion(userMessage: string): boolean {
    // If user can explain a concept in their own words with enough detail
    const wordCount = userMessage.split(/\s+/).length;
    const hasExplanation =
      /because|so that|which means|the reason|in order to/.test(
        userMessage.toLowerCase()
      );

    return wordCount > 15 && hasExplanation;
  }

  // Get the current teaching context to inject into AI prompts
  getTeachingContext(): string {
    const ctx: string[] = [];

    ctx.push(`Current teaching topic: "${this.plan.currentTopic}"`);
    if (this.plan.nextTopic !== this.plan.currentTopic) {
      ctx.push(`Next topic after this: "${this.plan.nextTopic}"`);
    }

    if (this.plan.shouldTest) {
      ctx.push(
        `ACTION REQUIRED: Test the user's understanding now. Ask them to explain the current concept (${this.plan.currentTopic}) in their own words.`
      );
    }

    if (this.plan.shouldStopUser) {
      ctx.push(
        `STOP THE USER: Say "wait." and explain why they shouldn't proceed. Reason: ${this.plan.stopReason}.`
      );
    }

    if (this.plan.shouldCelebrate) {
      ctx.push(
        `CELEBRATE: The user had a win (${this.plan.celebrationReason}). React genuinely. Make it feel real.`
      );
    }

    if (this.plan.topicsCompleted.length > 0) {
      ctx.push(
        `Topics already completed: ${this.plan.topicsCompleted.join(", ")}`
      );
    }

    if (this.plan.mistakesToReview.length > 0) {
      ctx.push(
        `Active mistakes to watch for: ${this.plan.mistakesToReview
          .map((m) => m.description)
          .join("; ")}`
      );
    }

    return ctx.join("\n");
  }

  markTested() {
    this.plan.messageCountSinceLastTest = 0;
    this.plan.shouldTest = false;
  }
}
