"use client";

import { RefObject } from "react";

interface ScreenSharePanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  onStop: () => void;
  onCapture: () => string | null;
}

export default function ScreenSharePanel({
  videoRef,
  onStop,
  onCapture,
}: ScreenSharePanelProps) {
  return (
    <div className="flex-shrink-0 w-72 border-l border-kira-border/50 bg-kira-surface/30 p-3 hidden lg:flex flex-col gap-3">
      {/* Preview header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-kira-textMuted">your screen</span>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-kira-green animate-pulse" />
          <span className="text-[10px] text-kira-green">live</span>
        </div>
      </div>

      {/* Video preview */}
      <div className="screen-preview aspect-video bg-kira-bg rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
      </div>

      {/* What AI sees */}
      <div className="bg-kira-surface rounded-lg p-3 border border-kira-border/50">
        <p className="text-[10px] text-kira-textMuted uppercase tracking-wider mb-1">
          what i see
        </p>
        <p className="text-xs text-kira-text/70">
          i can see your screen and guide you based on what's there. i don't
          save anything. just look, help, and forget.
        </p>
      </div>

      {/* Controls */}
      <div className="space-y-2">
        <button
          onClick={() => {
            const frame = onCapture();
            // Frame is captured and will be sent with next message
          }}
          className="w-full py-2 px-3 bg-kira-accent/10 border border-kira-accent/30 text-kira-accent text-xs rounded-lg hover:bg-kira-accent/20 transition-colors"
        >
          capture screen now
        </button>
        <button
          onClick={onStop}
          className="w-full py-2 px-3 bg-kira-surface border border-kira-border text-kira-textMuted text-xs rounded-lg hover:bg-kira-surfaceLight hover:text-kira-text transition-colors"
        >
          stop sharing
        </button>
      </div>

      {/* Privacy notice */}
      <p className="text-[10px] text-kira-textMuted/30 text-center mt-auto">
        screen data is processed locally and never stored.
      </p>
    </div>
  );
}
