"use client";

import { useState } from "react";
import { PersonalityType, PERSONALITIES } from "@/lib/types";

interface PersonalityPickerProps {
  onSelect: (personality: PersonalityType) => void;
  selected: PersonalityType | null;
}

export default function PersonalityPicker({
  onSelect,
  selected,
}: PersonalityPickerProps) {
  const [hoveredId, setHoveredId] = useState<PersonalityType | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleSelect = (id: PersonalityType) => {
    setConfirmed(true);
    onSelect(id);
  };

  return (
    <div className="border-t border-kira-border/50 bg-kira-surface/50 p-6 animate-fade-up">
      <div className="max-w-3xl mx-auto">
        <p className="text-center text-kira-textMuted text-sm mb-6">
          before we start — when you learn best, are you the type who wants a
          friend who's chill? or someone who's gonna push you? or someone who
          just patiently explains until it clicks? <span className="text-kira-text">i can be anything. you pick.</span>
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
          {PERSONALITIES.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`personality-card p-4 rounded-xl border text-left transition-all ${
                selected === p.id
                  ? "selected border-kira-accent bg-kira-accent/10"
                  : hoveredId === p.id
                  ? "border-kira-accent/50 bg-kira-surfaceLight"
                  : "border-kira-border bg-kira-surface"
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{p.emoji}</span>
                <span className="font-medium text-kira-text">{p.name}</span>
              </div>
              <p className="text-sm text-kira-textMuted">{p.description}</p>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-kira-textMuted/40 mt-4">
          you can change this anytime. this is just for now.
        </p>
      </div>
    </div>
  );
}
