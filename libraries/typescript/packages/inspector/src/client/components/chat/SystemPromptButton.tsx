import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Textarea } from "@/client/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { Check, Loader2, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CHAT_SYSTEM_PROMPT } from "./system-prompt-default";

function isSystemPromptCustomized(value: string | null): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return trimmed !== DEFAULT_CHAT_SYSTEM_PROMPT;
}

interface SystemPromptButtonProps {
  value: string | null;
  onSave: (prompt: string) => Promise<void>;
  disabled?: boolean;
  isSaving?: boolean;
  /** Icon-only circular style for the chat input toolbar. */
  compact?: boolean;
}

export function SystemPromptButton({
  value,
  onSave,
  disabled,
  isSaving = false,
  compact = false,
}: SystemPromptButtonProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }, [draft, onSave]);

  const savingState = isSaving || saving;
  const isCustomized = isSystemPromptCustomized(value);

  const trigger = (
    <button
      type="button"
      data-testid="chat-system-prompt-button"
      onClick={() => setOpen(true)}
      disabled={disabled}
      className={
        compact
          ? cn(
              "inline-flex h-auto w-auto aspect-square items-center justify-center rounded-full p-2 transition-colors disabled:pointer-events-none disabled:opacity-50",
              isCustomized
                ? "text-amber-500 dark:text-amber-400"
                : "text-muted-foreground hover:text-foreground"
            )
          : cn(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-input bg-secondary px-3 text-sm font-medium shadow-xs transition-colors hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50",
              isCustomized
                ? "text-amber-600 dark:text-amber-400"
                : "text-secondary-foreground"
            )
      }
    >
      <Settings2 className="h-4 w-4" />
      {!compact && <span className="hidden sm:inline">System Prompt</span>}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="top">
            <p>{isCustomized ? "Custom system prompt" : "System Prompt"}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>System Prompt</DialogTitle>
        </DialogHeader>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe the assistant's behavior..."
          className="min-h-[160px] text-sm"
        />
        <DialogFooter>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={savingState || draft === (value ?? "")}
            className="gap-1.5"
          >
            {savingState ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
