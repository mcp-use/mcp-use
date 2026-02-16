import { MCPChatMessageEvent, Telemetry } from "@/client/telemetry";
import type { McpServer } from "mcp-use/react";
import { useCallback, useRef, useState } from "react";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import {
  convertMessagesToLangChain,
  convertPromptResultsToMessages,
} from "./conversion";
import type { LLMConfig, Message, MessageAttachment } from "./types";
import { fileToAttachment, isValidTotalSize } from "./utils";

// Type alias for backward compatibility
type MCPConnection = McpServer;

interface UseChatMessagesClientSideProps {
  connection: MCPConnection;
  llmConfig: LLMConfig | null;
  isConnected: boolean;
  readResource?: (uri: string) => Promise<any>;
}

export function useChatMessagesClientSide({
  connection,
  llmConfig,
  isConnected,
  readResource,
}: UseChatMessagesClientSideProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const agentRef = useRef<any>(null);
  const llmRef = useRef<any>(null);

  const sendMessage = useCallback(
    async (userInput: string, promptResults: PromptResult[]) => {
      // Can send if there's text, prompt results, or attachments
      const hasContent =
        userInput.trim() || promptResults.length > 0 || attachments.length > 0;
      if (!hasContent || !llmConfig || !isConnected) {
        return;
      }

      const promptResultsMessages =
        convertPromptResultsToMessages(promptResults);

      // Create user message (always needed for externalHistory)
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userInput.trim(),
        timestamp: Date.now(),
        attachments: attachments.length > 0 ? [...attachments] : undefined,
      };

      // Only add user message to UI if there's actual user input or user-uploaded attachments
      // Don't show it when only using prompt results (they create their own messages)
      const userMessages: Message[] = [...promptResultsMessages];
      if (userInput.trim() || attachments.length > 0) {
        userMessages.push(userMessage);
      }

      setMessages((prev) => [...prev, ...userMessages]);
      setIsLoading(true);

      // Clear attachments after sending
      setAttachments([]);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      // Track telemetry
      const startTime = Date.now();
      let toolCallsCount = 0;

      try {
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
            state?: "pending" | "streaming" | "result" | "error";
            partialArgs?: Record<string, unknown>;
          };
        }> = [];

        // Accumulated partial JSON strings per tool call index (for streaming tool args)
        const toolCallArgBuffers = new Map<
          number,
          { name: string; accumulatedJson: string }
        >();

        // Throttled yield: allows React to flush re-renders during streaming
        // Without this, React batches all setMessages calls and the UI never sees intermediate states
        let lastYieldTime = 0;
        const YIELD_INTERVAL_MS = 80; // yield every 80ms for ~12fps updates
        const maybeYield = async () => {
          const now = Date.now();
          if (now - lastYieldTime >= YIELD_INTERVAL_MS) {
            lastYieldTime = now;
            await new Promise<void>((r) => setTimeout(r, 0));
          }
        };

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

        // Create LLM instance from config (reuse if config hasn't changed)
        if (
          !llmRef.current ||
          llmRef.current.provider !== llmConfig.provider ||
          llmRef.current.model !== llmConfig.model ||
          llmRef.current.apiKey !== llmConfig.apiKey
        ) {
          let llm: any;
          if (llmConfig.provider === "openai") {
            const { ChatOpenAI } = await import("@langchain/openai");
            llm = new ChatOpenAI({
              model: llmConfig.model,
              apiKey: llmConfig.apiKey,
            });
          } else if (llmConfig.provider === "anthropic") {
            const { ChatAnthropic } = await import("@langchain/anthropic");
            llm = new ChatAnthropic({
              model: llmConfig.model,
              apiKey: llmConfig.apiKey,
            });
          } else if (llmConfig.provider === "google") {
            const { ChatGoogleGenerativeAI } =
              await import("@langchain/google-genai");
            llm = new ChatGoogleGenerativeAI({
              model: llmConfig.model,
              apiKey: llmConfig.apiKey,
            });
          } else {
            throw new Error(`Unsupported LLM provider: ${llmConfig.provider}`);
          }

          llmRef.current = {
            instance: llm,
            provider: llmConfig.provider,
            model: llmConfig.model,
            apiKey: llmConfig.apiKey,
          };
        }

        // Create or reuse agent
        if (
          !agentRef.current ||
          agentRef.current.llm !== llmRef.current.instance
        ) {
          // Dynamic import from browser export to avoid bundling server-side code
          const { MCPAgent } = await import("mcp-use/browser");

          agentRef.current = new MCPAgent({
            llm: llmRef.current.instance,
            client: (connection.client ?? undefined) as any,
            memoryEnabled: false, // external history always used
            systemPrompt:
              "You are a helpful assistant with access to MCP tools, prompts, and resources. Help users interact with the MCP server.",
          });
          await agentRef.current.initialize();
        } else {
          console.log(
            "[useChatMessagesClientSide] Reusing existing agent. History length:",
            agentRef.current.conversationHistory?.length
          );
        }

        // Stream events from agent
        // Don't include the new userMessage here - streamEvents() appends it internally
        // as new HumanMessage(query), so including it would cause duplication
        const externalHistory = convertMessagesToLangChain([
          ...messages,
          ...promptResultsMessages,
        ]);

        for await (const event of agentRef.current.streamEvents(
          userInput,
          10, // maxSteps
          false, // manageConnector - don't manage, already connected
          externalHistory, // externalHistory - keep history external to include prompt results AND new message
          undefined, // outputSchema
          abortControllerRef.current?.signal // pass abort signal to enable immediate cancellation
        )) {
          // Check for abort (defensive - signal is also passed to LangChain)
          if (abortControllerRef.current?.signal.aborted) {
            break;
          }

          // Handle text streaming and tool call argument streaming
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data?.chunk;

            // Handle text tokens
            if (chunk?.text) {
              const text = chunk.text;
              if (typeof text === "string" && text.length > 0) {
                currentTextPart += text;

                // Update or add text part
                const lastPart = parts[parts.length - 1];
                if (lastPart && lastPart.type === "text") {
                  lastPart.text = currentTextPart;
                } else {
                  parts.push({
                    type: "text",
                    text: currentTextPart,
                  });
                }

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, parts: [...parts] }
                      : msg
                  )
                );
              }
            }

            // Handle streaming tool call argument chunks
            // LangChain AIMessageChunk may expose tool call data in several places:
            // - tool_call_chunks (standard LangChain AIMessageChunk property)
            // - kwargs.tool_call_chunks (serialized format)
            // - lc_kwargs.tool_call_chunks (LC serialization format)
            // - additional_kwargs.tool_calls (OpenAI raw format)
            // - tool_calls (accumulated tool calls on the chunk)
            const toolCallChunks =
              chunk?.tool_call_chunks ||
              chunk?.kwargs?.tool_call_chunks ||
              chunk?.lc_kwargs?.tool_call_chunks ||
              chunk?.additional_kwargs?.tool_calls ||
              chunk?.tool_calls;
            if (
              toolCallChunks &&
              Array.isArray(toolCallChunks) &&
              toolCallChunks.length > 0
            ) {
              // Finalize any pending text part before tool streaming begins
              if (currentTextPart) {
                currentTextPart = "";
              }

              for (const tc of toolCallChunks) {
                const idx = tc.index ?? 0;
                const name = tc.name || "";
                const argsFragment = tc.args || "";

                // Accumulate partial JSON for this tool call index
                let buffer = toolCallArgBuffers.get(idx);
                if (!buffer) {
                  buffer = { name: name || "unknown", accumulatedJson: "" };
                  toolCallArgBuffers.set(idx, buffer);
                }
                if (name && buffer.name === "unknown") {
                  buffer.name = name;
                }

                // Best-effort parse the accumulated partial JSON
                let partialArgs: Record<string, unknown> | undefined;

                // If args is already an object (e.g. from chunk.tool_calls), use directly
                if (typeof argsFragment === "object" && argsFragment !== null) {
                  partialArgs = argsFragment as Record<string, unknown>;
                } else if (typeof argsFragment === "string" && argsFragment) {
                  // Accumulate JSON string fragments (from tool_call_chunks)
                  buffer.accumulatedJson += argsFragment;

                  try {
                    partialArgs = JSON.parse(buffer.accumulatedJson);
                  } catch {
                    // Best-effort recovery: try to close the JSON gracefully
                    // Strategy: strip the last incomplete key-value pair, close open strings/brackets/braces
                    const strategies = [
                      // Strategy 1 (preferred): Close unclosed strings and braces
                      // This PRESERVES the last key-value even if incomplete (e.g. streaming "code" field)
                      () => {
                        let r = buffer.accumulatedJson;
                        const quotes = (r.match(/(?<!\\)"/g) || []).length;
                        if (quotes % 2 !== 0) r += '"';
                        const ob =
                          (r.match(/{/g) || []).length -
                          (r.match(/}/g) || []).length;
                        const oq =
                          (r.match(/\[/g) || []).length -
                          (r.match(/]/g) || []).length;
                        for (let i = 0; i < oq; i++) r += "]";
                        for (let i = 0; i < ob; i++) r += "}";
                        return JSON.parse(r);
                      },
                      // Strategy 2 (fallback): Strip last incomplete key-value, close braces
                      () => {
                        let r = buffer.accumulatedJson;
                        r = r.replace(
                          /,\s*"[^"]*"?\s*:\s*("([^"\\]|\\.)*)?$/,
                          ""
                        );
                        r = r.replace(/,\s*"[^"]*$/, "");
                        const quotes = (r.match(/(?<!\\)"/g) || []).length;
                        if (quotes % 2 !== 0) r += '"';
                        const ob =
                          (r.match(/{/g) || []).length -
                          (r.match(/}/g) || []).length;
                        const oq =
                          (r.match(/\[/g) || []).length -
                          (r.match(/]/g) || []).length;
                        for (let i = 0; i < oq; i++) r += "]";
                        for (let i = 0; i < ob; i++) r += "}";
                        return JSON.parse(r);
                      },
                    ];
                    for (const strategy of strategies) {
                      try {
                        partialArgs = strategy();
                        break;
                      } catch {
                        // Try next strategy
                      }
                    }
                  }
                }

                if (partialArgs) {
                  // Find or create the streaming tool-invocation part
                  const toolPart = parts.find(
                    (p) =>
                      p.type === "tool-invocation" &&
                      p.toolInvocation?.state === "streaming" &&
                      p.toolInvocation?.toolName === buffer!.name
                  );

                  if (toolPart && toolPart.toolInvocation) {
                    // Only update if the new parse is better (more keys or longer
                    // string values). This prevents flickering when the JSON recovery
                    // alternates between strategies that include/exclude trailing keys.
                    const prev = toolPart.toolInvocation.partialArgs;
                    const prevKeys = prev ? Object.keys(prev) : [];
                    const newKeys = Object.keys(partialArgs);
                    const prevTotal = prevKeys.reduce(
                      (s, k) => s + String(prev![k] ?? "").length,
                      0
                    );
                    const newTotal = newKeys.reduce(
                      (s, k) => s + String(partialArgs[k] ?? "").length,
                      0
                    );
                    if (
                      newKeys.length > prevKeys.length ||
                      newTotal >= prevTotal
                    ) {
                      toolPart.toolInvocation.partialArgs = partialArgs;
                    }
                  } else {
                    parts.push({
                      type: "tool-invocation",
                      toolInvocation: {
                        toolName: buffer.name,
                        args: {},
                        state: "streaming",
                        partialArgs,
                      },
                    });
                  }

                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, parts: [...parts] }
                        : msg
                    )
                  );

                  // Yield to event loop so React can flush the streaming update
                  await maybeYield();
                }
              }
            }
          }
          // Handle tool start
          else if (event.event === "on_tool_start") {
            if (currentTextPart) {
              currentTextPart = "";
            }

            // Extract args from event data - check multiple possible locations
            let args = {};
            if (event.data?.input) {
              args = event.data.input;
            } else if (event.data?.tool_input) {
              args = event.data.tool_input;
            } else if (event.data) {
              // Sometimes the args are directly in data
              args = event.data;
            }

            console.log("[useChatMessagesClientSide] on_tool_start:", {
              toolName: event.name,
              eventData: event.data,
              extractedArgs: args,
            });
            // Count tool calls for telemetry
            toolCallsCount++;

            // Check if we already have a streaming part for this tool (from tool_call_chunks)
            const streamingPart = parts.find(
              (p) =>
                p.type === "tool-invocation" &&
                p.toolInvocation?.state === "streaming" &&
                p.toolInvocation?.toolName === (event.name || "unknown")
            );

            if (streamingPart && streamingPart.toolInvocation) {
              // Transition from streaming to pending with complete args
              streamingPart.toolInvocation.args = args;
              streamingPart.toolInvocation.state = "pending";
              // Keep partialArgs around - the widget iframe may still be loading
              // and needs them when it becomes ready. They'll be ignored once
              // the full toolInput is sent via sendToolInput.
            } else {
              parts.push({
                type: "tool-invocation",
                toolInvocation: {
                  toolName: event.name || "unknown",
                  args,
                  state: "pending",
                },
              });
            }

            // Clear tool call arg buffers for this tool
            toolCallArgBuffers.clear();

            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, parts: [...parts] }
                  : msg
              )
            );
          }
          // Handle tool end
          else if (event.event === "on_tool_end") {
            const toolPart = parts.find(
              (p) =>
                p.type === "tool-invocation" &&
                p.toolInvocation?.toolName === event.name &&
                !p.toolInvocation?.result
            );

            console.log("[useChatMessagesClientSide] on_tool_end event:", {
              toolName: event.name,
              hasToolPart: !!toolPart,
              output: event.data?.output,
            });

            if (toolPart && toolPart.toolInvocation) {
              let result = event.data?.output;

              // Unwrap LangChain ToolMessage wrapper: kwargs.content contains the actual output
              if (
                result?.kwargs?.content &&
                typeof result.kwargs.content === "string"
              ) {
                try {
                  result = JSON.parse(result.kwargs.content);
                } catch (error) {
                  console.warn(
                    "[useChatMessagesClientSide] Failed to parse kwargs.content:",
                    error
                  );
                  result = result.kwargs.content;
                }
              }
              // Fallback: try parsing result.content if it's a string
              else if (result?.content && typeof result.content === "string") {
                try {
                  result = JSON.parse(result.content);
                } catch (error) {
                  result = result.content;
                }
              }

              // Store the unwrapped result
              toolPart.toolInvocation.result = result;
              // Check if result indicates an error
              toolPart.toolInvocation.state = result?.isError
                ? "error"
                : "result";

              // Check result's _meta field for Apps SDK component
              const appsSdkUri = result?._meta?.["openai/outputTemplate"];

              console.log("[useChatMessagesClientSide] Tool result:", {
                toolName: event.name,
                hasMeta: !!result?._meta,
                hasStructuredContent: !!result?.structuredContent,
                appsSdkUri,
              });

              if (
                appsSdkUri &&
                typeof appsSdkUri === "string" &&
                readResource
              ) {
                // Fetch the resource now (await instead of IIFE)
                console.log(
                  "[useChatMessagesClientSide] Detected Apps SDK component, fetching resource:",
                  appsSdkUri
                );
                try {
                  // Use the readResource function passed from the inspector connection
                  const resourceData = await readResource(appsSdkUri);

                  console.log(
                    "[useChatMessagesClientSide] Resource fetched:",
                    resourceData
                  );

                  // Extract structured content from result
                  const structuredContent = result?.structuredContent || null;

                  // Add the fetched resource contents to the result's content array
                  if (
                    resourceData?.contents &&
                    Array.isArray(resourceData.contents)
                  ) {
                    // Convert resource contents to MCP resource format
                    const mcpResources = resourceData.contents.map(
                      (content: any) => ({
                        type: "resource",
                        resource: content,
                      })
                    );

                    console.log(
                      "[useChatMessagesClientSide] Created MCP resources:",
                      mcpResources
                    );

                    // Update the tool result with the fetched resources
                    const updatedResult = {
                      ...result,
                      content: [...(result.content || []), ...mcpResources],
                      structuredContent,
                    };

                    toolPart.toolInvocation.result = updatedResult;
                    console.log(
                      "[useChatMessagesClientSide] Updated result with resources"
                    );
                  } else {
                    console.warn(
                      "[useChatMessagesClientSide] No contents in resourceData:",
                      resourceData
                    );
                  }
                } catch (error) {
                  console.error("Failed to fetch Apps SDK resource:", error);
                }
              }

              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, parts: [...parts] }
                    : msg
                )
              );
            }
          }
        }

        // If aborted, mark any pending tool calls as cancelled
        if (abortControllerRef.current?.signal.aborted) {
          for (const part of parts) {
            if (
              part.type === "tool-invocation" &&
              part.toolInvocation?.state === "pending"
            ) {
              part.toolInvocation.state = "error";
              part.toolInvocation.result = "Cancelled by user";
            }
          }
        }

        // Final update
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  parts: [...parts],
                  content: "",
                }
              : msg
          )
        );

        // Track successful chat message
        if (llmConfig) {
          const telemetry = Telemetry.getInstance();
          telemetry
            .capture(
              new MCPChatMessageEvent({
                serverId: connection.url,
                provider: llmConfig.provider,
                model: llmConfig.model,
                messageCount: messages.length + 1,
                toolCallsCount,
                success: true,
                executionMode: "client-side",
                duration: Date.now() - startTime,
              })
            )
            .catch(() => {
              // Silently fail - telemetry should not break the application
            });
        }
      } catch (error) {
        // Don't show AbortError - user initiated cancellation
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("Client-side agent error:", error);

        // Extract detailed error message
        let errorDetail = "Unknown error occurred";
        if (error instanceof Error) {
          errorDetail = error.message;
          // Check if error has HTTP status info
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

        // Track failed chat message
        if (llmConfig) {
          const telemetry = Telemetry.getInstance();
          telemetry
            .capture(
              new MCPChatMessageEvent({
                serverId: connection.url,
                provider: llmConfig.provider,
                model: llmConfig.model,
                messageCount: messages.length + 1,
                toolCallsCount,
                success: false,
                executionMode: "client-side",
                duration: Date.now() - startTime,
                error: errorDetail,
              })
            )
            .catch(() => {
              // Silently fail - telemetry should not break the application
            });
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
    [connection, llmConfig, isConnected, messages, readResource, attachments]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    if (agentRef.current) {
      agentRef.current.clearConversationHistory();
    }
  }, []);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const addAttachment = useCallback(async (file: File) => {
    try {
      const attachment = await fileToAttachment(file);

      setAttachments((prev) => {
        const newAttachments = [...prev, attachment];

        // Check total size
        if (!isValidTotalSize(newAttachments)) {
          alert("Total attachment size exceeds 20MB limit");
          return prev;
        }

        return newAttachments;
      });
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert("Failed to add attachment");
      }
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  return {
    messages,
    isLoading,
    attachments,
    sendMessage,
    clearMessages,
    stop,
    addAttachment,
    removeAttachment,
    clearAttachments,
  };
}
