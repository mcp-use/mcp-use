import type { PromptResult } from "../../hooks/useMCPPrompts";
import { MessageSquare, X } from "lucide-react";
import { Button } from "../ui/button";

export interface PromptResultsListProps {
  promptResults: PromptResult[];
  onDeletePromptResult: (index: number) => void;
}

export function PromptResultsList({
  promptResults,
  onDeletePromptResult,
}: PromptResultsListProps) {
  return (
    <div
      className="absolute top-4 left-4 right-4 flex gap-2 overflow-x-auto z-20 flex-nowrap"
      style={{
        scrollbarWidth: "none" /* Firefox */,
        msOverflowStyle: "none" /* IE/Edge */,
      }}
    >
      {/* Prompt cards */}
      {promptResults.map(({ promptName }, index) => (
        <Button
          key={index}
          type="button"
          className="flex items-center gap-2 bg-zinc-200 text-zinc-700 dark:text-zinc-300 text-[10px] px-1.5 py-0.5 dark:bg-zinc-700 rounded-lg border border-zinc-200 dark:border-zinc-300 font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600"
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={promptName}>
            {promptName}
          </span>
          <span
            className="ml-1 h-4 w-4 rounded-full bg-zinc-400 dark:bg-zinc-600 hover:bg-zinc-500 dark:hover:bg-zinc-500 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onDeletePromptResult(index);
            }}
            title="Remove prompt"
            role="button"
            tabIndex={0}
          >
            <X className="h-2.5 w-2.5 text-white" />
          </span>
        </Button>
      ))}
    </div>
  );
}
