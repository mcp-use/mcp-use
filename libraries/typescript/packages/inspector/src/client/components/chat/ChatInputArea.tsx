import { Send } from "lucide-react";
import React from "react";

import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";

interface ChatInputAreaProps {
  inputValue: string;
  isConnected: boolean;
  isLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
}

export function ChatInputArea({
  inputValue,
  isConnected,
  isLoading,
  textareaRef,
  onInputChange,
  onKeyDown,
  onSendMessage,
}: ChatInputAreaProps) {
  return (
    <div className="w-full flex flex-col justify-center items-center p-2 sm:p-4 sm:pt-0 text-foreground">
      <div className="relative w-full max-w-3xl backdrop-blur-xl">
        <Textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={isConnected ? "Ask a question" : "Server not connected"}
          className="p-4 min-h-[150px] max-h-[300px] rounded-xl bg-zinc-50 z-10 focus:bg-zinc-100 dark:text-white dark:bg-black border-gray-200 dark:border-zinc-800"
          disabled={!isConnected || isLoading}
        />
        <div className="absolute left-0 p-3 bottom-0 w-full flex justify-end items-end">
          <div className="flex items-center gap-2">
            {isLoading ? (
              <button
                className="bg-muted hover:bg-muted/80 text-foreground p-3 rounded-full font-medium flex items-center justify-center h-10 transition-colors border border-border aspect-square w-auto min-w-none"
                title="Stop streaming"
                type="button"
                onClick={() => {
                  // Stop functionality would go here if needed
                }}
              >
                <Spinner className="h-4 w-4" />
              </button>
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
