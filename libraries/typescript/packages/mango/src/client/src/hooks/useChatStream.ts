import { useState, useEffect, useCallback, useRef } from "react";

export type MessagePart =
  | { type: "text"; content: string }
  | {
      type: "tool_call";
      tool: string;
      input: any;
      tool_use_id?: string;
      result?: any;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string; // Keep for backward compatibility, but parts is the source of truth
  timestamp: Date;
  parts?: MessagePart[]; // Ordered list of text chunks and tool calls
  toolCalls?: Array<{
    tool: string;
    input: any;
    tool_use_id?: string;
  }>; // Keep for backward compatibility
}

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  devServerUrl: string | null;
  devServerStatus: "starting" | "ready" | "error" | null;
  conversationId: string;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  stop: () => void;
}

export function useChatStream(): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devServerUrl, setDevServerUrl] = useState<string | null>(null);
  const [devServerStatus, setDevServerStatus] = useState<
    "starting" | "ready" | "error" | null
  >(null);
  const [conversationId, setConversationId] = useState<string>(
    () => `conv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  );

  // AbortController to stop ongoing requests
  const abortControllerRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null
  );

  const stop = useCallback(() => {
    // Abort the fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Cancel the reader
    if (readerRef.current) {
      readerRef.current.cancel();
      readerRef.current = null;
    }

    // Reset streaming state
    setIsStreaming(false);
  }, []);

  const clearMessages = useCallback(() => {
    // Stop any ongoing streams
    stop();

    setMessages([]);
    setError(null);
    setDevServerUrl(null);
    setDevServerStatus(null);
    setConversationId(
      `conv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    );
  }, [stop]);

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
        // Create a new AbortController for this request
        abortControllerRef.current = new AbortController();

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
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.body) {
          throw new Error("Response body is null");
        }

        // Read the SSE stream
        const reader = response.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();

        let assistantMessageId: string | null = null;
        let assistantContent = "";
        let currentTextPart = "";
        let buffer = "";
        // Track partial tool input JSON by tool_use_id
        const partialToolInputs = new Map<string, string>();

        // Read the stream
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            setIsStreaming(false);
            readerRef.current = null;
            abortControllerRef.current = null;
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
                        parts: [],
                      },
                    ]);
                  }

                  // Append token to current text part
                  currentTextPart += data.text;
                  assistantContent += data.text;

                  // Filter out XML-style function call tags from current text part
                  const cleanedCurrentText = currentTextPart
                    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "")
                    .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
                    .replace(/<function_calls\/>/g, "");

                  // Filter full content for backward compatibility
                  const cleanedContent = assistantContent
                    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "")
                    .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
                    .replace(/<function_calls\/>/g, "")
                    .trim();

                  // Update the last text part or create a new one
                  const currentAssistantMessageId = assistantMessageId;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id === currentAssistantMessageId) {
                        const parts = [...(msg.parts || [])];
                        // Update or add text part
                        const lastPart = parts[parts.length - 1];
                        if (lastPart && lastPart.type === "text") {
                          // Update existing text part with cleaned current text
                          parts[parts.length - 1] = {
                            type: "text",
                            content: cleanedCurrentText,
                          };
                        } else {
                          // Add new text part
                          parts.push({
                            type: "text",
                            content: cleanedCurrentText,
                          });
                        }
                        return {
                          ...msg,
                          content: cleanedContent,
                          parts,
                        };
                      }
                      return msg;
                    })
                  );
                } else if (data.type === "tool_use_start") {
                  // Handle tool use start - create tool call part with just tool name
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
                        parts: currentAssistantContent
                          ? [{ type: "text", content: currentAssistantContent }]
                          : [],
                        toolCalls: [],
                      },
                    ]);
                  }

                  // Finalize current text part if it exists
                  if (currentTextPart.trim()) {
                    const currentAssistantMessageId = assistantMessageId;
                    // Clean the text part
                    const cleanedText = currentTextPart
                      .replace(
                        /<function_calls>[\s\S]*?<\/function_calls>/g,
                        ""
                      )
                      .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
                      .replace(/<function_calls\/>/g, "")
                      .trim();

                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id === currentAssistantMessageId) {
                          const parts = [...(msg.parts || [])];
                          const lastPart = parts[parts.length - 1];
                          if (lastPart && lastPart.type === "text") {
                            // Update existing text part
                            parts[parts.length - 1] = {
                              type: "text",
                              content: cleanedText,
                            };
                          } else {
                            // Add new text part
                            parts.push({
                              type: "text",
                              content: cleanedText,
                            });
                          }
                          return { ...msg, parts };
                        }
                        return msg;
                      })
                    );
                    currentTextPart = "";
                  }

                  // Initialize partial input for this tool
                  partialToolInputs.set(data.tool_use_id, "");

                  // Add tool call as a new part with empty input
                  const currentAssistantMessageId = assistantMessageId;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id === currentAssistantMessageId) {
                        const parts = [...(msg.parts || [])];
                        parts.push({
                          type: "tool_call",
                          tool: data.tool,
                          input: {},
                          tool_use_id: data.tool_use_id,
                        });
                        return {
                          ...msg,
                          toolCalls: [
                            ...(msg.toolCalls || []),
                            {
                              tool: data.tool,
                              input: {},
                              tool_use_id: data.tool_use_id,
                            },
                          ],
                          parts,
                        };
                      }
                      return msg;
                    })
                  );
                } else if (data.type === "tool_input_delta") {
                  // Handle streaming tool input - update partial JSON
                  if (assistantMessageId && data.tool_use_id) {
                    // Accumulate partial JSON
                    const currentPartial =
                      partialToolInputs.get(data.tool_use_id) || "";
                    const newPartial =
                      currentPartial + (data.partial_json || "");
                    partialToolInputs.set(data.tool_use_id, newPartial);

                    // Try to parse the partial JSON (it may be incomplete)
                    let parsedInput: any = {};
                    try {
                      // Try to parse the accumulated JSON
                      parsedInput = JSON.parse(newPartial);
                    } catch {
                      // JSON is incomplete - show as a special streaming indicator
                      // We'll display the raw JSON with a note that it's streaming
                      parsedInput = {
                        _streaming: true,
                        _partial_json: newPartial,
                      };
                    }

                    // Update the tool call part with partial input
                    const currentAssistantMessageId = assistantMessageId;
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id === currentAssistantMessageId) {
                          const parts = [...(msg.parts || [])];
                          const toolCallIndex = parts.findIndex(
                            (part) =>
                              part.type === "tool_call" &&
                              part.tool_use_id === data.tool_use_id
                          );
                          if (toolCallIndex !== -1) {
                            const toolCall = parts[toolCallIndex];
                            if (toolCall.type === "tool_call") {
                              parts[toolCallIndex] = {
                                ...toolCall,
                                input: parsedInput,
                              };
                            }
                          }
                          return { ...msg, parts };
                        }
                        return msg;
                      })
                    );
                  }
                } else if (data.type === "tool_use") {
                  // Handle complete tool use event (backward compatibility)
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
                        parts: currentAssistantContent
                          ? [{ type: "text", content: currentAssistantContent }]
                          : [],
                        toolCalls: [],
                      },
                    ]);
                  }

                  // Finalize current text part if it exists
                  if (currentTextPart.trim()) {
                    const currentAssistantMessageId = assistantMessageId;
                    // Clean the text part
                    const cleanedText = currentTextPart
                      .replace(
                        /<function_calls>[\s\S]*?<\/function_calls>/g,
                        ""
                      )
                      .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
                      .replace(/<function_calls\/>/g, "")
                      .trim();

                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id === currentAssistantMessageId) {
                          const parts = [...(msg.parts || [])];
                          const lastPart = parts[parts.length - 1];
                          if (lastPart && lastPart.type === "text") {
                            // Update existing text part
                            parts[parts.length - 1] = {
                              type: "text",
                              content: cleanedText,
                            };
                          } else {
                            // Add new text part
                            parts.push({
                              type: "text",
                              content: cleanedText,
                            });
                          }
                          return { ...msg, parts };
                        }
                        return msg;
                      })
                    );
                    currentTextPart = "";
                  }

                  // Update or add tool call with complete input
                  const currentAssistantMessageId = assistantMessageId;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id === currentAssistantMessageId) {
                        const parts = [...(msg.parts || [])];
                        const toolCallIndex = parts.findIndex(
                          (part) =>
                            part.type === "tool_call" &&
                            part.tool_use_id === data.tool_use_id
                        );
                        if (toolCallIndex !== -1) {
                          // Update existing tool call
                          const toolCall = parts[toolCallIndex];
                          if (toolCall.type === "tool_call") {
                            parts[toolCallIndex] = {
                              ...toolCall,
                              input: data.input,
                            };
                          }
                        } else {
                          // Add new tool call
                          parts.push({
                            type: "tool_call",
                            tool: data.tool,
                            input: data.input,
                            tool_use_id: data.tool_use_id,
                          });
                        }
                        return {
                          ...msg,
                          toolCalls: [
                            ...(msg.toolCalls || []),
                            {
                              tool: data.tool,
                              input: data.input,
                              tool_use_id: data.tool_use_id,
                            },
                          ],
                          parts,
                        };
                      }
                      return msg;
                    })
                  );
                  // Clear partial input for this tool
                  partialToolInputs.delete(data.tool_use_id);
                } else if (data.type === "tool_result") {
                  // Handle tool results - match with corresponding tool call in parts
                  if (assistantMessageId && data.tool_use_id) {
                    const currentAssistantMessageId = assistantMessageId;
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id === currentAssistantMessageId) {
                          const parts = [...(msg.parts || [])];
                          // Find the tool call with matching tool_use_id and update it with result
                          const toolCallIndex = parts.findIndex(
                            (part) =>
                              part.type === "tool_call" &&
                              part.tool_use_id === data.tool_use_id
                          );
                          if (toolCallIndex !== -1) {
                            const toolCall = parts[toolCallIndex];
                            if (toolCall.type === "tool_call") {
                              parts[toolCallIndex] = {
                                ...toolCall,
                                result: data.result,
                              };
                            }
                          }
                          return { ...msg, parts };
                        }
                        return msg;
                      })
                    );
                  }
                } else if (data.type === "dev_server_status") {
                  // Handle dev server status updates
                  setDevServerStatus(data.status);
                  if (data.status === "ready" && data.url) {
                    setDevServerUrl(data.url);
                  } else if (data.status === "error") {
                    setDevServerUrl(null);
                  }
                  // Also add as system message for visibility
                  const statusMessage: ChatMessage = {
                    id: `dev-server-status-${Date.now()}-${Math.random()}`,
                    role: "system",
                    content: data.message || `Dev server: ${data.status}`,
                    timestamp: new Date(),
                  };
                  setMessages((prev) => [...prev, statusMessage]);
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
                  // Finalize any remaining text part
                  if (assistantMessageId && currentTextPart.trim()) {
                    const currentAssistantMessageId = assistantMessageId;
                    // Clean the text part
                    const cleanedText = currentTextPart
                      .replace(
                        /<function_calls>[\s\S]*?<\/function_calls>/g,
                        ""
                      )
                      .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
                      .replace(/<function_calls\/>/g, "")
                      .trim();

                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id === currentAssistantMessageId) {
                          const parts = [...(msg.parts || [])];
                          const lastPart = parts[parts.length - 1];
                          if (lastPart && lastPart.type === "text") {
                            parts[parts.length - 1] = {
                              type: "text",
                              content: cleanedText,
                            };
                          } else {
                            parts.push({
                              type: "text",
                              content: cleanedText,
                            });
                          }
                          return { ...msg, parts };
                        }
                        return msg;
                      })
                    );
                  }
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
        // Don't show error if it was aborted by user
        if (err.name === "AbortError") {
          console.log("Stream aborted by user");
        } else {
          setError(err.message || "Failed to send message");
        }
        setIsStreaming(false);
        readerRef.current = null;
        abortControllerRef.current = null;
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
    devServerUrl,
    devServerStatus,
    conversationId,
    sendMessage,
    clearMessages,
    stop,
  };
}
