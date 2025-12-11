import { Send } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils.js";

export interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Chat input component
 */
export function ChatInput({
  onSendMessage,
  disabled = false,
  placeholder = "Ask Mango to create or modify an MCP server...",
}: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    onSendMessage(input);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-2 p-4 border-t border-border"
    >
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "flex-1 resize-none rounded-lg border border-border bg-background px-4 py-3",
          "text-sm placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "min-h-[60px] max-h-[200px]"
        )}
        rows={2}
      />
      <button
        type="submit"
        disabled={disabled || !input.trim()}
        className={cn(
          "rounded-lg bg-primary px-4 py-3 text-primary-foreground",
          "hover:bg-primary/90 transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "flex items-center justify-center"
        )}
      >
        <Send className="h-5 w-5" />
      </button>
    </form>
  );
}
