import type { Prompt } from "@modelcontextprotocol/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const PROMPT_TRIGGER_REGEX = /(?:^\/$|\s+\/$)/;
const PROMPT_ARROW_KEYS = ["ArrowDown", "ArrowUp", "Escape", "Enter"];

export function usePromptDropdown({
  inputValue,
  setInputValue,
  prompts,
  executePrompt,
  textareaRef,
}: {
  inputValue: string;
  setInputValue: (value: string) => void;
  prompts: Prompt[];
  executePrompt: (prompt: Prompt, args: Record<string, unknown>) => Promise<void>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [promptsDropdownOpen, setPromptsDropdownOpen] = useState(false);
  const [promptFocusedIndex, setPromptFocusedIndex] = useState(-1);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const triggerSpanRef = useRef<{ start: number; end: number } | null>(null);

  const filteredPrompts = prompts;

  const clearPromptsUIState = useCallback(() => {
    setPromptsDropdownOpen(false);
    setPromptFocusedIndex(-1);
    triggerSpanRef.current = null;
  }, []);

  const updatePromptsDropdownState = useCallback(() => {
    if (!textareaRef.current) return;
    const caretIndex = textareaRef.current.selectionStart;
    const textUpToCaret = inputValue.slice(0, caretIndex);
    const isPromptsRequested = PROMPT_TRIGGER_REGEX.test(textUpToCaret);
    setPromptsDropdownOpen(isPromptsRequested);
    if (isPromptsRequested) {
      triggerSpanRef.current = { start: caretIndex - 1, end: caretIndex };
      setPromptFocusedIndex(0);
    } else {
      clearPromptsUIState();
    }
  }, [inputValue, clearPromptsUIState, textareaRef]);

  useEffect(() => {
    updatePromptsDropdownState();
  }, [inputValue, updatePromptsDropdownState]);

  const clearPromptsState = useCallback(() => {
    setSelectedPrompt(null);
    clearPromptsUIState();
  }, [clearPromptsUIState]);

  const handlePromptSelect = useCallback(
    async (prompt: Prompt) => {
      setSelectedPrompt(prompt);
      if (prompt.arguments && prompt.arguments.length > 0) {
        setSelectedPrompt(null);
        toast.error("Prompts with arguments are not supported", {
          description:
            "This prompt requires arguments which are not yet supported in chat mode.",
        });
        return;
      }
      try {
        await executePrompt(prompt, {});
      } catch (error) {
        console.error("Error executing prompt", error);
      } finally {
        if (textareaRef.current && triggerSpanRef.current) {
          const { start, end } = triggerSpanRef.current;
          const next = inputValue.slice(0, start) + inputValue.slice(end);
          setInputValue(next);
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(start, start);
          });
        }
        clearPromptsState();
      }
    },
    [executePrompt, clearPromptsState, inputValue, setInputValue, textareaRef]
  );

  const handlePromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "ArrowDown") {
        setPromptFocusedIndex((prev) => {
          if (filteredPrompts.length === 0) return -1;
          return (prev + 1) % filteredPrompts.length;
        });
      } else if (e.key === "ArrowUp") {
        setPromptFocusedIndex((prev) => {
          if (filteredPrompts.length === 0) return -1;
          return (prev - 1 + filteredPrompts.length) % filteredPrompts.length;
        });
      } else if (e.key === "Escape") {
        e.stopPropagation();
        clearPromptsUIState();
      } else if (e.key === "Enter" && promptFocusedIndex >= 0) {
        const prompt = filteredPrompts[promptFocusedIndex];
        if (prompt) handlePromptSelect(prompt);
      }
    },
    [
      filteredPrompts,
      promptFocusedIndex,
      handlePromptSelect,
      clearPromptsUIState,
    ]
  );

  const wrapTextareaKeyDown = useCallback(
    (
      onSend: () => void,
      existingHandler?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
    ) =>
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (PROMPT_ARROW_KEYS.includes(e.key) && promptsDropdownOpen) {
          e.preventDefault();
          handlePromptKeyDown(e);
          return;
        }
        existingHandler?.(e);
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      },
    [handlePromptKeyDown, promptsDropdownOpen]
  );

  return {
    promptsDropdownOpen,
    promptFocusedIndex,
    selectedPrompt,
    filteredPrompts,
    handlePromptSelect,
    handlePromptKeyDown,
    wrapTextareaKeyDown,
    clearPromptsState,
    PROMPT_ARROW_KEYS,
  };
}
