import { Send, Square } from "lucide-react";
import React from "react";
import { PromptResultsList } from "./PromptResultsList";
import { PromptsDropdown } from "./PromptsDropdown";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { cn } from "@/client/lib/utils";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import type { PromptResult } from "../../hooks/useMCPPrompts";

interface ChatInputAreaProps {
  inputValue: string;
  isConnected: boolean;
  isLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  promptsDropdownOpen: boolean;
  promptFocusedIndex: number;
  prompts: Prompt[];
  selectedPrompt: Prompt | null;
  promptResults: PromptResult[];
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick: () => void;
  onSendMessage: () => void;
  onStopStreaming: () => void;
  onPromptSelect: (prompt: Prompt) => void;
  onDeletePromptResult: (index: number) => void;
}

export function ChatInputArea({
  inputValue,
  isConnected,
  isLoading,
  textareaRef,
  promptsDropdownOpen,
  promptFocusedIndex,
  prompts,
  selectedPrompt,
  promptResults,
  onInputChange,
  onKeyDown,
  onKeyUp,
  onClick,
  onSendMessage,
  onStopStreaming,
  onPromptSelect,
  onDeletePromptResult,
}: ChatInputAreaProps) {
  return (
    <div className="w-full flex flex-col justify-center items-center p-2 sm:p-4 sm:pt-0 text-foreground">
      <div className="relative w-full max-w-3xl backdrop-blur-xl">
        <PromptsDropdown
          isOpen={promptsDropdownOpen}
          prompts={prompts}
          selectedPrompt={selectedPrompt}
          focusedIndex={promptFocusedIndex}
          onPromptSelect={onPromptSelect}
        />
        <PromptResultsList
          promptResults={promptResults}
          onDeletePromptResult={onDeletePromptResult}
        />
        <Textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onClick={onClick}
          placeholder={isConnected ? "Ask a question" : "Server not connected"}
          className={cn(
            "p-4 min-h-[150px] max-h-[300px] rounded-xl bg-zinc-50 z-10 focus:bg-zinc-100 dark:text-white dark:bg-black border-gray-200 dark:border-zinc-800",
            promptResults.length > 0 && "pt-16"
          )}
          disabled={!isConnected || isLoading}
        />
        <div className="absolute left-0 p-3 bottom-0 w-full flex justify-end items-end">
          <div className="flex items-center gap-2">
            {isLoading ? (
              <Button
                className="min-w-none h-auto w-auto aspect-square rounded-full items-center justify-center flex"
                title="Stop streaming"
                type="button"
                onClick={onStopStreaming}
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                disabled={!inputValue.trim() || !isConnected || isLoading}
                className="min-w-none h-auto w-auto aspect-square rounded-full items-center justify-center flex"
                title="Send"
                type="button"
                onClick={onSendMessage}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
