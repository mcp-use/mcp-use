import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "../types.js";

export interface UseMangoChat {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

/**
 * Hook for managing Mango chat state and streaming
 */
export function useMangoChat(workspaceDir?: string): UseMangoChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      console.log("[Mango] Sending message:", content);

      // Add user message
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);

      // Create abort controller
      abortControllerRef.current = new AbortController();

      try {
        // Prepare messages for API
        const apiMessages = [...messages, userMessage].map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        console.log("[Mango] Calling API with", apiMessages.length, "messages");

        // Start streaming
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: apiMessages,
            workspaceDir,
          }),
          signal: abortControllerRef.current.signal,
        });

        console.log("[Mango] Response status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[Mango] API error:", errorText);
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        const assistantMessageId = Date.now().toString();
        let currentContent = "";
        let currentThinking = "";
        const toolCalls: any[] = [];

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim() || !line.startsWith("data: ")) continue;

            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);

              if (event.type === "content_block_start") {
                const block = event.content_block;
                if (block?.type === "thinking") {
                  // Start showing thinking indicator
                  setMessages((prev) => {
                    const lastMsg = prev[prev.length - 1];
                    if (
                      lastMsg?.role === "assistant" &&
                      lastMsg.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        { ...lastMsg, isThinking: true },
                      ];
                    } else {
                      return [
                        ...prev,
                        {
                          id: assistantMessageId,
                          role: "assistant" as const,
                          content: "",
                          timestamp: new Date(),
                          toolCalls: [],
                          isThinking: true,
                          thinking: "",
                        },
                      ];
                    }
                  });
                }
              } else if (event.type === "content_block_delta") {
                const delta = event.delta;
                if (delta?.type === "text_delta") {
                  currentContent += delta.text;

                  // Update or create assistant message
                  setMessages((prev) => {
                    const lastMsg = prev[prev.length - 1];
                    if (
                      lastMsg?.role === "assistant" &&
                      lastMsg.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMsg,
                          content: currentContent,
                          isThinking: false,
                        },
                      ];
                    } else {
                      return [
                        ...prev,
                        {
                          id: assistantMessageId,
                          role: "assistant" as const,
                          content: currentContent,
                          timestamp: new Date(),
                          toolCalls: [],
                        },
                      ];
                    }
                  });
                } else if (delta?.type === "thinking_delta") {
                  currentThinking += delta.thinking;

                  // Update thinking content
                  setMessages((prev) => {
                    const lastMsg = prev[prev.length - 1];
                    if (
                      lastMsg?.role === "assistant" &&
                      lastMsg.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMsg,
                          thinking: currentThinking,
                          isThinking: true,
                        },
                      ];
                    }
                    return prev;
                  });
                }
              } else if (event.type === "content_block_stop") {
                // Stop thinking indicator
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (
                    lastMsg?.role === "assistant" &&
                    lastMsg.id === assistantMessageId &&
                    lastMsg.isThinking
                  ) {
                    return [
                      ...prev.slice(0, -1),
                      { ...lastMsg, isThinking: false },
                    ];
                  }
                  return prev;
                });
              } else if (event.type === "tool_progress") {
                // Show tool progress in real-time
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (
                    lastMsg?.role === "assistant" &&
                    lastMsg.id === assistantMessageId
                  ) {
                    const progressText = `\n🔧 ${event.tool_name}: ${event.message}`;
                    return [
                      ...prev.slice(0, -1),
                      { ...lastMsg, content: currentContent + progressText },
                    ];
                  }
                  return prev;
                });
              } else if (event.type === "tool_result") {
                toolCalls.push({
                  toolName: event.tool_name,
                  result: event.result,
                });

                // Update assistant message with tool calls
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (
                    lastMsg?.role === "assistant" &&
                    lastMsg.id === assistantMessageId
                  ) {
                    return [...prev.slice(0, -1), { ...lastMsg, toolCalls }];
                  }
                  return prev;
                });
              } else if (event.type === "error") {
                console.error("Stream error:", event.error);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: Date.now().toString(),
                    role: "assistant" as const,
                    content: `Error: ${event.error}`,
                    timestamp: new Date(),
                  },
                ]);
              }
            } catch (e) {
              console.error("Failed to parse event:", e);
            }
          }
        }
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("Stream aborted");
        } else {
          console.error("Chat error:", error);
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: "assistant" as const,
              content: `Error: ${error.message}`,
              timestamp: new Date(),
            },
          ]);
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [messages, isStreaming, workspaceDir]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    clearMessages,
  };
}
