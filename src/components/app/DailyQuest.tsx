"use client";

import { useState, useEffect } from "react";
import { Quest } from "@/lib/types";
import { getTodayQuest, completeQuest, addQuest } from "@/lib/storage";

interface DailyQuestProps {
  onClose: () => void;
}

// Pre-built quests for different tools
const QUEST_TEMPLATES: Record<string, string[]> = {
  "google ads": [
    "open your google ads and find the 'audiences' section. don't change anything. just find it and tell me what you see.",
    "look at your campaign list. count how many campaigns you have active. that's it. just count.",
    "go to keywords in any ad group. find one keyword with low search volume. just find it.",
    "check your click-through rate on any ad. is it above 2%? just check.",
    "find your negative keywords list. add one negative keyword that makes sense for your business.",
  ],
  figma: [
    "open figma. create a new frame. set it to mobile size. that's the whole quest.",
    "find the auto-layout feature in the toolbar. just find it. don't click it yet.",
    "look at your layers panel. count how many layers you have. just count.",
    "create a text layer. type anything. that's it.",
    "find the components panel. look at it for 30 seconds. just look.",
  ],
  shopify: [
    "open your shopify admin. find the 'products' section. just find it.",
    "look at your most recent order. what did they buy? just look.",
    "go to your online store. look at your homepage as a customer would. what do you notice?",
    "find your shipping settings. are they right for your products? just check.",
    "check your analytics. what's your most visited page? just find out.",
  ],
  default: [
    "open the tool you're learning. just open it. look around for 2 minutes. that's the quest.",
    "find one feature you've never noticed before. just find it.",
    "try to do one thing without any help. just one small thing.",
    "close the tool. now try to remember where 3 buttons are. open it and check if you were right.",
    "teach someone (or pretend to teach someone) one thing you learned this week.",
  ],
};

export default function DailyQuest({ onClose }: DailyQuestProps) {
  const [quest, setQuest] = useState<Quest | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let todayQuest = getTodayQuest();
    if (!todayQuest) {
      // Generate a new quest for today
      const templates =
        QUEST_TEMPLATES["default"];
      const randomTemplate =
        templates[Math.floor(Math.random() * templates.length)];

      todayQuest = {
        id: Math.random().toString(36).substring(2),
        description: randomTemplate,
        completed: false,
        date: new Date().toISOString().split("T")[0],
        tool: "learning",
      };
      addQuest(todayQuest);
    }
    setQuest(todayQuest);
    setCompleted(todayQuest.completed);
  }, []);

  const handleComplete = () => {
    if (quest) {
      completeQuest(quest.id);
      setCompleted(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-kira-surface border border-kira-border rounded-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-kira-accent uppercase tracking-wider font-medium">
              today's quest
            </span>
            <button
              onClick={onClose}
              className="p-1 text-kira-textMuted hover:text-kira-text transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {completed ? (
            <div className="text-center py-8">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-kira-green font-medium">
                done. you showed up today. that matters.
              </p>
              <p className="text-sm text-kira-textMuted mt-2">
                tomorrow's quest: something slightly harder.
              </p>
            </div>
          ) : (
            <>
              <p className="text-kira-text text-lg leading-relaxed mb-6">
                {quest?.description || "loading..."}
              </p>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleComplete}
                  className="flex-1 py-3 bg-kira-accent hover:bg-kira-accentLight text-white rounded-xl transition-all btn-glow font-medium"
                >
                  i did it
                </button>
                <button
                  onClick={onClose}
                  className="py-3 px-6 bg-kira-surface border border-kira-border text-kira-textMuted rounded-xl hover:text-kira-text transition-colors"
                >
                  later
                </button>
              </div>

              <p className="text-xs text-kira-textMuted/40 mt-4 text-center">
                takes like 2 minutes. small. doable. not overwhelming.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
