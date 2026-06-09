"use client";

import { UserProfile } from "@/lib/types";

interface SidebarProps {
  user: UserProfile | null;
  isScreenSharing: boolean;
  onShowMistakes: () => void;
  onShowQuest: () => void;
  onClose: () => void;
}

export default function Sidebar({
  user,
  isScreenSharing,
  onShowMistakes,
  onShowQuest,
  onClose,
}: SidebarProps) {
  return (
    <div className="flex-shrink-0 w-64 border-r border-kira-border/50 bg-kira-surface/30 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-kira-border/30">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-kira-text">kira</span>
          <button
            onClick={onClose}
            className="p-1 text-kira-textMuted hover:text-kira-text transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* User info */}
        {user && (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-kira-textMuted uppercase tracking-wider">
                learning
              </p>
              <p className="text-sm text-kira-text">{user.tool}</p>
            </div>
            <div>
              <p className="text-[10px] text-kira-textMuted uppercase tracking-wider">
                real goal
              </p>
              <p className="text-sm text-kira-accent">{user.realGoal}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-kira-textMuted uppercase tracking-wider">
                streak
              </span>
              <span className="text-sm text-kira-green">
                {user.streakDays} day{user.streakDays !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 p-3 space-y-1">
        <SidebarButton
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          label="conversation"
          active
        />
        <SidebarButton
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          }
          label="mistake bank"
          onClick={onShowMistakes}
        />
        <SidebarButton
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          }
          label="today's quest"
          onClick={onShowQuest}
        />

        <div className="pt-2 mt-2 border-t border-kira-border/30">
          <div className="px-3 py-2">
            <p className="text-[10px] text-kira-textMuted uppercase tracking-wider mb-2">
              screen
            </p>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isScreenSharing ? "bg-kira-green" : "bg-kira-textMuted/30"
                }`}
              />
              <span className="text-xs text-kira-textMuted">
                {isScreenSharing ? "sharing" : "not sharing"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-kira-border/30">
        <p className="text-[10px] text-kira-textMuted/30 text-center">
          the teacher you always wished you had
        </p>
      </div>
    </div>
  );
}

function SidebarButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? "bg-kira-accent/10 text-kira-accent"
          : "text-kira-textMuted hover:text-kira-text hover:bg-kira-surfaceLight"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
