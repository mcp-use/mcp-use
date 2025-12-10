/**
 * useMango - Hook for managing Mango chat state
 */

import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "../../types.js";

export interface LLMConfig {
  provider: "openai" | "anthropic" | "google";
  apiKey: string;
  model?: string;
}

export interface UseMangoOptions {
  apiBaseUrl?: string;
  llmConfig?: LLMConfig;
  onServerCreated?: (serverUrl: string, projectName: string) => void;
}

export interface UseMangoReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (message: string) => Promise<void>;
  clearMessages: () => void;
  setLLMConfig: (config: LLMConfig) => void;
}

export function useMango(options: UseMangoOptions = {}): UseMangoReturn {
  // In dev mode, requests to /mango will be proxied by Vite to the API server
  // In production, both client and API are served from the same origin
  const { apiBaseUrl = "/mango", onServerCreated } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmConfig, setLLMConfig] = useState<LLMConfig | undefined>(
    options.llmConfig
  );

  const abortControllerRef = useRef<AbortController | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) return;
      if (!llmConfig) {
        setError("LLM configuration is required");
        return;
      }

      // Cancel any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        setIsLoading(true);
        setError(null);

        // Add user message
        const userMessage: ChatMessage = {
          role: "user",
          content: message,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);

        // Prepare conversation history for API
        const conversationHistory = messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        // Call streaming API
        const response = await fetch(`${apiBaseUrl}/chat/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            model: llmConfig.model,
            conversationHistory,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP error: ${response.status}`);
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        // Read the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantContent = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const data = JSON.parse(line);

              if (data.type === "greeting") {
                // Add greeting as first assistant message
                const greetingMessage: ChatMessage = {
                  role: "assistant",
                  content: data.content,
                  timestamp: new Date(),
                };
                setMessages((prev) => [...prev, greetingMessage]);
              } else if (data.type === "step") {
                // Accumulate step information
                if (data.data?.observation) {
                  assistantContent += data.data.observation + "\n";
                }
              } else if (data.type === "complete") {
                // Final assistant message
                if (assistantContent) {
                  const assistantMessage: ChatMessage = {
                    role: "assistant",
                    content: assistantContent.trim(),
                    timestamp: new Date(),
                  };
                  setMessages((prev) => [...prev, assistantMessage]);
                }
              } else if (data.type === "error") {
                throw new Error(data.error || "Unknown error");
              }

              // Check for server creation events
              if (
                data.data?.observation &&
                data.data.observation.includes(
                  "Successfully started MCP server"
                )
              ) {
                // Extract server URL and project name from the response
                const urlMatch = data.data.observation.match(
                  /URL: (http:\/\/[^\s]+)/
                );
                const nameMatch =
                  data.data.observation.match(/server "([^"]+)"/);

                if (urlMatch && nameMatch && onServerCreated) {
                  onServerCreated(urlMatch[1], nameMatch[1]);
                }
              }
            } catch (parseError) {
              console.warn("Failed to parse stream chunk:", line, parseError);
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Request was cancelled
          return;
        }

        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError(errorMessage);

        // Add error message to chat
        const errorMsg: ChatMessage = {
          role: "assistant",
          content: `❌ Error: ${errorMessage}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [apiBaseUrl, llmConfig, messages, onServerCreated]
  );

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    setLLMConfig,
  };
}
