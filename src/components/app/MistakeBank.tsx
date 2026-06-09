"use client";

import { useState, useEffect } from "react";
import { Mistake } from "@/lib/types";
import { getMistakes, resolveMistake } from "@/lib/storage";

interface MistakeBankProps {
  onClose: () => void;
}

export default function MistakeBank({ onClose }: MistakeBankProps) {
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [selectedMistake, setSelectedMistake] = useState<Mistake | null>(null);

  useEffect(() => {
    setMistakes(getMistakes().filter((m) => !m.resolved));
  }, []);

  const handleResolve = (id: string) => {
    resolveMistake(id);
    setMistakes((prev) => prev.filter((m) => m.id !== id));
    setSelectedMistake(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-kira-surface border border-kira-border rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-kira-border/50">
          <div>
            <h2 className="text-lg font-medium text-kira-text">
              your mistake bank
            </h2>
            <p className="text-sm text-kira-textMuted mt-1">
              every mistake you fix is one less time you'll be stuck.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-kira-textMuted hover:text-kira-text transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Mistakes list */}
        <div className="flex-1 overflow-y-auto p-6">
          {mistakes.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">🛡️</p>
              <p className="text-kira-textMuted">
                no mistakes yet. that's either really good or you haven't started.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {mistakes
                .sort((a, b) => b.count - a.count)
                .map((mistake, index) => (
                  <div
                    key={mistake.id}
                    className="p-4 bg-kira-bg border border-kira-border/50 rounded-xl"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <span className="text-kira-red text-sm mt-0.5">#{index + 1}</span>
                        <div>
                          <p className="text-kira-text text-sm">
                            {mistake.description}
                          </p>
                          <p className="text-xs text-kira-textMuted mt-1">
                            happened {mistake.count} time{mistake.count > 1 ? "s" : ""} · {mistake.category}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleResolve(mistake.id)}
                        className="text-xs text-kira-accent hover:text-kira-accentLight transition-colors flex-shrink-0"
                      >
                        mark fixed
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-kira-border/50">
          <p className="text-xs text-kira-textMuted/50 text-center">
            the mistake bank is your armor. every mistake you fix is one less time you'll be stuck.
          </p>
        </div>
      </div>
    </div>
  );
}
