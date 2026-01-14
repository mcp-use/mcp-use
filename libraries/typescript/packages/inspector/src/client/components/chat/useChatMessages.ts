import type { AuthConfig, LLMConfig, Message } from "./types";
import { useCallback, useState, useRef } from "react";
import { hashString } from "./utils";

interface UseChatMessagesProps {
  mcpServerUrl: string;
  llmConfig: LLMConfig | null;
  authConfig: AuthConfig | null;
  isConnected: boolean;
}

export function useChatMessages({
  mcpServerUrl,
  llmConfig,
  authConfig,
  isConnected,
}: UseChatMessagesProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (userInput: string) => {
      if (!userInput.trim() || !llmConfig || !isConnected) {
        return;
      }

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userInput.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      try {
        // If using OAuth, retrieve tokens from localStorage
        let authConfigWithTokens = authConfig;
        if (authConfig?.type === "oauth") {
          try {
            // Get OAuth tokens from localStorage (same pattern as BrowserOAuthClientProvider)
            // The key format is: `${storageKeyPrefix}_${serverUrlHash}_tokens`
            const storageKeyPrefix = "mcp:auth";
            const serverUrlHash = hashString(mcpServerUrl);
            const storageKey = `${storageKeyPrefix}_${serverUrlHash}_tokens`;
            const tokensStr = localStorage.getItem(storageKey);
            if (tokensStr) {
              const tokens = JSON.parse(tokensStr);
              authConfigWithTokens = {
                ...authConfig,
                oauthTokens: tokens,
              };
            } else {
              console.warn(
                "No OAuth tokens found in localStorage for key:",
                storageKey
              );
            }
          } catch (error) {
            console.warn("Failed to retrieve OAuth tokens:", error);
          }
        }

        // Call the streaming chat API endpoint
        const response = await fetch("/inspector/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({
            mcpServerUrl,
            llmConfig,
            authConfig: authConfigWithTokens,
            messages: [...messages, userMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Create assistant message that will be updated with streaming content
        const assistantMessageId = `assistant-${Date.now()}`;
        let currentTextPart = "";
        const parts: Array<{
          type: "text" | "tool-invocation";
          text?: string;
          toolInvocation?: {
            toolName: string;
            args: Record<string, unknown>;
            result?: any;
            state?: string;
          };
        }> = [];

        // Add empty assistant message to start
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            parts: [],
          },
        ]);

        // Read the streaming response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error("No response body");
        }

        let buffer = "";
        while (true) {
          // Check for abort
          if (abortControllerRef.current?.signal.aborted) {
            await reader.cancel();
            break;
          }

          const { done, value } = await reader.read();

          if (done) break;

          // Decode the chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;

            // SSE format: lines start with "data: "
            if (!line.startsWith("data: ")) continue;

            try {
              const event = JSON.parse(line.slice(6)); // Remove "data: " prefix
              console.log(
                "[Client received event]",
                event.type,
                event.toolName || event.content?.slice?.(0, 30)
              );

              if (event.type === "message") {
                // Initial assistant message - just log it
                console.log("[Message started]", event.id);
              } else if (event.type === "text") {
                // Streaming text content from LLM
                currentTextPart += event.content;

                // Update or add text part
                const lastPart = parts[parts.length - 1];
                if (lastPart && lastPart.type === "text") {
                  // Update existing text part
                  lastPart.text = currentTextPart;
                } else {
                  // Add new text part
                  parts.push({
                    type: "text",
                    text: currentTextPart,
                  });
                }
                console.log(
                  "[Parts after text]",
                  parts.length,
                  "parts, text length:",
                  currentTextPart.length
                );

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, parts: [...parts] }
                      : msg
                  )
                );
              } else if (event.type === "tool-call") {
                // Tool invocation started - finalize current text and add tool part
                if (currentTextPart) {
                  currentTextPart = "";
                }

                parts.push({
                  type: "tool-invocation",
                  toolInvocation: {
                    toolName: event.toolName,
                    args: event.args,
                    state: "pending",
                  },
                });
                console.log(
                  "[Parts after tool-call]",
                  parts.length,
                  "parts, tool:",
                  event.toolName
                );

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, parts: [...parts] }
                      : msg
                  )
                );
              } else if (event.type === "tool-result") {
                // Tool invocation completed
                const toolPart = parts.find(
                  (p) =>
                    p.type === "tool-invocation" &&
                    p.toolInvocation?.toolName === event.toolName &&
                    !p.toolInvocation?.result
                );

                if (toolPart && toolPart.toolInvocation) {
                  toolPart.toolInvocation.result = event.result;
                  toolPart.toolInvocation.state = "result";
                  console.log(
                    "[Parts after tool-result]",
                    parts.length,
                    "parts, updated:",
                    event.toolName
                  );

                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, parts: [...parts] }
                        : msg
                    )
                  );
                } else {
                  console.warn(
                    "[tool-result] Could not find matching tool part for",
                    event.toolName
                  );
                }
              } else if (event.type === "done") {
                // Final update - use done data if available
                console.log("[Done] Final parts:", parts.length);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          parts: [...parts],
                          content: "", // Clear content since we're using parts
                        }
                      : msg
                  )
                );
              } else if (event.type === "error") {
                throw new Error(event.message || "Streaming error");
              }
            } catch (parseError) {
              console.error(
                "Failed to parse streaming event:",
                parseError,
                line
              );
            }
          }
        }
      } catch (error) {
        // Don't show Abort Error
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        // Extract detailed error message with HTTP status
        let errorDetail = "Unknown error occurred";
        if (error instanceof Error) {
          errorDetail = error.message;
          const errorAny = error as any;
          if (errorAny.status) {
            errorDetail = `HTTP ${errorAny.status}: ${errorDetail}`;
          }
          if (
            errorAny.code === 401 ||
            errorDetail.includes("401") ||
            errorDetail.includes("Unauthorized")
          ) {
            errorDetail = `Authentication failed (401). Check your Authorization header in the connection settings.`;
          }
        }

        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Error: ${errorDetail}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [llmConfig, isConnected, mcpServerUrl, messages, authConfig]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    stop,
  };
}
