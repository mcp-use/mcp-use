import { useState, useEffect, useCallback } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: Array<{
    tool: string;
    input: any;
    tool_use_id?: string;
  }>;
}

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export function useChatStream(): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>(
    () => `conv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setConversationId(
      `conv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    );
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setError(null);

      try {
        // Send the message and get SSE stream directly
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [...messages, userMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
            conversationId,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.body) {
          throw new Error("Response body is null");
        }

        // Read the SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let assistantMessageId: string | null = null;
        let assistantContent = "";
        let buffer = "";

        // Read the stream
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            setIsStreaming(false);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data: StreamEvent = JSON.parse(line.slice(6));

                // Handle token-by-token streaming
                if (data.type === "token" && data.text) {
                  if (!assistantMessageId) {
                    assistantMessageId = `msg-${Date.now()}-assistant`;
                    const currentAssistantMessageId = assistantMessageId;
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: currentAssistantMessageId,
                        role: "assistant",
                        content: "",
                        timestamp: new Date(),
                      },
                    ]);
                  }

                  // Append token to assistant message
                  assistantContent += data.text;

                  // Filter out XML-style function call tags
                  const cleanedContent = assistantContent
                    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "")
                    .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
                    .replace(/<function_calls\/>/g, "")
                    .trim();

                  const currentAssistantMessageId = assistantMessageId;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === currentAssistantMessageId
                        ? { ...msg, content: cleanedContent }
                        : msg
                    )
                  );
                } else if (data.type === "tool_use") {
                  // Handle tool use events - ensure we have an assistant message
                  if (!assistantMessageId) {
                    assistantMessageId = `msg-${Date.now()}-assistant`;
                    const currentAssistantMessageId = assistantMessageId;
                    const currentAssistantContent = assistantContent;
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: currentAssistantMessageId,
                        role: "assistant",
                        content: currentAssistantContent,
                        timestamp: new Date(),
                        toolCalls: [],
                      },
                    ]);
                  }

                  // Append tool call to current assistant message (interleaved with text)
                  const currentAssistantMessageId = assistantMessageId;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === currentAssistantMessageId
                        ? {
                            ...msg,
                            toolCalls: [
                              ...(msg.toolCalls || []),
                              {
                                tool: data.tool,
                                input: data.input,
                                tool_use_id: data.tool_use_id,
                              },
                            ],
                          }
                        : msg
                    )
                  );
                } else if (data.type === "tool_result") {
                  // Handle tool results - append to current assistant message
                  if (assistantMessageId) {
                    // Add tool result as a system message or append to assistant message
                    const resultMessage: ChatMessage = {
                      id: `tool-result-${Date.now()}-${Math.random()}`,
                      role: "system",
                      content: `Tool result: ${typeof data.result === "string" ? data.result : JSON.stringify(data.result)}`,
                      timestamp: new Date(),
                    };
                    setMessages((prev) => [...prev, resultMessage]);
                  }
                } else if (
                  data.type === "status" ||
                  data.type === "phase_status" ||
                  data.type === "sandbox_status" ||
                  data.type === "mcp_status" ||
                  data.type === "transition"
                ) {
                  // Add status messages
                  const statusMessage: ChatMessage = {
                    id: `status-${Date.now()}-${Math.random()}`,
                    role: "system",
                    content: data.message || data.status || "Processing...",
                    timestamp: new Date(),
                  };
                  setMessages((prev) => [...prev, statusMessage]);
                } else if (data.type === "error") {
                  setError(data.error || "An error occurred");
                  setIsStreaming(false);
                  break;
                } else if (data.type === "stream_complete") {
                  setIsStreaming(false);
                  break;
                }
              } catch (err) {
                console.error("Error parsing SSE event:", err);
              }
            }
          }
        }
      } catch (err: any) {
        setError(err.message || "Failed to send message");
        setIsStreaming(false);
      }
    },
    [messages, conversationId, isStreaming]
  );

  useEffect(() => {
    return () => {
      // Cleanup is handled in the sendMessage function
    };
  }, []);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearMessages,
  };
}
