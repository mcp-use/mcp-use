"use client";

import { useCallback, useState } from "react";
import { Play, Square } from "lucide-react";
import { cn } from "@/client/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";

export const CONNECT_PANEL_MESH_ANIMATION_PAUSED_KEY =
  "mcp-inspector-connect-panel-mesh-animation-paused";

export const CHAT_MESH_ANIMATION_PAUSED_KEY =
  "mcp-inspector-chat-mesh-animation-paused";

function readPaused(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

export function useMeshAnimationPaused(storageKey: string) {
  const [paused, setPaused] = useState(() => readPaused(storageKey));

  const toggle = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "true" : "false");
      } catch {
        // ignore quota / private mode
      }
      return next;
    });
  }, [storageKey]);

  return { paused, toggle };
}

const pauseButtonClassName =
  "z-50 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-zinc-500/60 bg-transparent text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-800 dark:border-zinc-500/50 dark:text-zinc-400 dark:hover:border-zinc-400 dark:hover:text-zinc-200";

interface MeshAnimationPauseButtonProps {
  paused: boolean;
  onToggle: () => void;
  className?: string;
}

export function MeshAnimationPauseButton({
  paused,
  onToggle,
  className,
}: MeshAnimationPauseButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onToggle}
            aria-label={paused ? "Resume animation" : "Pause animation"}
            className={cn(pauseButtonClassName, className)}
          >
            {paused ? (
              <Play className="ml-px h-3 w-3" fill="currentColor" />
            ) : (
              <Square className="h-2.5 w-2.5" fill="currentColor" />
            )}
          </button>
        }
        nativeButton
      />
      <TooltipContent side="left">
        <p>{paused ? "Resume animation" : "Pause animation"}</p>
      </TooltipContent>
    </Tooltip>
  );
}
