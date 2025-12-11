import { Bot, Brain, User, Wrench } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../types.js";
import { cn } from "../../lib/utils.js";

export interface MessageListProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
}

/**
 * Message list component
 */
export function MessageList({
  messages,
  isStreaming = false,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center space-y-4">
          <div className="text-6xl">🥭</div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Welcome to Mango</h2>
            <p className="text-muted-foreground">
              Your AI agent for MCP server development
            </p>
          </div>
          <div className="text-sm text-muted-foreground max-w-md">
            Ask me to create a new MCP server, modify existing code, or test
            your tools. I'll handle everything from scaffolding to testing.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "flex gap-3",
            message.role === "user" ? "justify-end" : "justify-start"
          )}
        >
          {message.role === "assistant" && (
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
              <Bot className="h-5 w-5 text-orange-500" />
            </div>
          )}

          <div
            className={cn(
              "max-w-[80%] rounded-lg px-4 py-3 space-y-2",
              message.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted"
            )}
          >
            {message.isThinking && (
              <div className="mb-2 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                <Brain className="h-3 w-3 animate-pulse" />
                <span className="font-semibold">Thinking...</span>
              </div>
            )}

            {message.thinking && (
              <div className="mb-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded p-2 space-y-1">
                <div className="flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  <Brain className="h-3 w-3" />
                  <span>Extended Thinking</span>
                </div>
                <div className="text-xs text-blue-600 dark:text-blue-400 whitespace-pre-wrap">
                  {message.thinking}
                </div>
              </div>
            )}

            <div className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>

            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border/50">
                {message.toolCalls.map((toolCall, idx) => (
                  <div
                    key={idx}
                    className="text-xs bg-background/50 rounded p-2 space-y-1"
                  >
                    <div className="flex items-center gap-1 font-semibold">
                      <Wrench className="h-3 w-3" />
                      <span>{toolCall.toolName}</span>
                    </div>
                    {toolCall.result?.message && (
                      <div className="text-muted-foreground">
                        {toolCall.result.message}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              {message.timestamp.toLocaleTimeString()}
            </div>
          </div>

          {message.role === "user" && (
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
          )}
        </div>
      ))}

      {isStreaming && (
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-orange-500 animate-pulse" />
          </div>
          <div className="bg-muted rounded-lg px-4 py-3">
            <div className="flex gap-1">
              <span className="animate-bounce">●</span>
              <span className="animate-bounce [animation-delay:0.2s]">●</span>
              <span className="animate-bounce [animation-delay:0.4s]">●</span>
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
