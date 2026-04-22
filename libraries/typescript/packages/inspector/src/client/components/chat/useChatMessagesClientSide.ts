import { MCPChatMessageEvent, Telemetry } from "@/client/telemetry";
import { runToolLoop } from "@/llm/toolLoop";
import type { ProviderTool } from "@/llm/types";
import type { McpServer } from "mcp-use/react";
import { useCallback, useRef, useState } from "react";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import {
  convertMessagesToProvider,
  convertPromptResultsToMessages,
} from "./conversion";
import type { LLMConfig, Message, MessageAttachment } from "./types";
import { fileToAttachment, isValidTotalSize } from "./utils";

// Type alias for backward compatibility
type MCPConnection = McpServer;

interface WidgetModelContext {
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

interface UseChatMessagesClientSideProps {
  connection: MCPConnection;
  llmConfig: LLMConfig | null;
  isConnected: boolean;
  readResource?: (uri: string) => Promise<any>;
  widgetModelContexts?: Map<string, WidgetModelContext | undefined>;
  disabledTools?: Set<string>;
}

const SYSTEM_PROMPT =
  "You are a helpful assistant with access to MCP tools. Help users interact with the MCP server.";

export function useChatMessagesClientSide({
  connection,
  llmConfig,
  isConnected,
  readResource,
  widgetModelContexts,
  disabledTools,
}: UseChatMessagesClientSideProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      userInput: string,
      promptResults: PromptResult[],
      extraAttachments?: MessageAttachment[]
    ) => {
      const allAttachments = [...attachments, ...(extraAttachments ?? [])];
      const hasContent =
        userInput.trim() ||
        promptResults.length > 0 ||
        allAttachments.length > 0;
      if (!hasContent || !llmConfig || !isConnected) {
        return;
      }

      const promptResultsMessages =
        convertPromptResultsToMessages(promptResults);

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userInput.trim(),
        timestamp: Date.now(),
        attachments: allAttachments.length > 0 ? allAttachments : undefined,
      };

      const userMessages: Message[] = [...promptResultsMessages];
      if (userInput.trim() || allAttachments.length > 0) {
        userMessages.push(userMessage);
      }

      setMessages((prev) => [...prev, ...userMessages]);
      setIsLoading(true);
      setAttachments([]);

      abortControllerRef.current = new AbortController();
      const startTime = Date.now();
      let toolCallsCount = 0;

      try {
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

        // Per-tool-call accumulated JSON for partial-args rendering.
        const toolCallArgBuffers = new Map<
          string,
          { name: string; accumulatedJson: string }
        >();

        // Throttled yield: allows React to flush re-renders during streaming.
        let lastYieldTime = 0;
        const YIELD_INTERVAL_MS = 80;
        const maybeYield = async () => {
          const now = Date.now();
          if (now - lastYieldTime >= YIELD_INTERVAL_MS) {
            lastYieldTime = now;
            await new Promise<void>((r) => setTimeout(r, 0));
          }
        };

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

        // Discover + filter tools from the live MCP connection.
        const allTools = connection.tools ?? [];
        const toolList: ProviderTool[] = allTools
          .filter((t) => !disabledTools?.has(t.name))
          .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
              type: "object",
            },
          }));

        // Build the provider-neutral message stream (system + history + widget
        // state context + optional multimodal user turn).
        const widgetContextMessages: Message[] = [];
        if (widgetModelContexts && widgetModelContexts.size > 0) {
          const widgetParts: string[] = [];
          for (const [, ctx] of widgetModelContexts) {
            if (!ctx) continue;
            if (ctx.content?.length) {
              widgetParts.push(ctx.content.map((c) => c.text).join("\n"));
            } else if (ctx.structuredContent) {
              widgetParts.push(JSON.stringify(ctx.structuredContent));
            }
          }
          if (widgetParts.length > 0) {
            widgetContextMessages.push({
              id: `widget-context-${Date.now()}`,
              role: "user",
              content: `[Current Widget State]\n${widgetParts.join("\n")}`,
              timestamp: Date.now(),
            });
          }
        }

        const hasImageAttachments = (userMessage.attachments?.length ?? 0) > 0;
        const historyMessages = [
          ...messages,
          ...promptResultsMessages,
          ...widgetContextMessages,
          ...(userInput.trim() || hasImageAttachments ? [userMessage] : []),
        ];

        const providerMessages = convertMessagesToProvider(historyMessages);
        providerMessages.unshift({
          role: "system",
          content: SYSTEM_PROMPT,
        });

        // Helper: best-effort parse of accumulated tool-args JSON so the UI
        // can render the tool input progressively before the call completes.
        const tryParseArgs = (
          raw: string
        ): Record<string, unknown> | undefined => {
          try {
            return JSON.parse(raw);
          } catch {
            // Try to close unclosed strings/brackets/braces.
            const strategies: Array<() => unknown> = [
              () => {
                let r = raw;
                const quotes = (r.match(/(?<!\\)"/g) || []).length;
                if (quotes % 2 !== 0) r += '"';
                const ob =
                  (r.match(/{/g) || []).length - (r.match(/}/g) || []).length;
                const oq =
                  (r.match(/\[/g) || []).length - (r.match(/]/g) || []).length;
                for (let i = 0; i < oq; i++) r += "]";
                for (let i = 0; i < ob; i++) r += "}";
                return JSON.parse(r);
              },
              () => {
                let r = raw;
                r = r.replace(/,\s*"[^"]*"?\s*:\s*("([^"\\]|\\.)*)?$/, "");
                r = r.replace(/,\s*"[^"]*$/, "");
                const quotes = (r.match(/(?<!\\)"/g) || []).length;
                if (quotes % 2 !== 0) r += '"';
                const ob =
                  (r.match(/{/g) || []).length - (r.match(/}/g) || []).length;
                const oq =
                  (r.match(/\[/g) || []).length - (r.match(/]/g) || []).length;
                for (let i = 0; i < oq; i++) r += "]";
                for (let i = 0; i < ob; i++) r += "}";
                return JSON.parse(r);
              },
            ];
            for (const strat of strategies) {
              try {
                return strat() as Record<string, unknown>;
              } catch {
                // next
              }
            }
            return undefined;
          }
        };

        const commitMessageParts = () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, parts: [...parts] }
                : msg
            )
          );
        };

        const maybeFetchAppsSdkResource = async (toolPart: {
          type: "text" | "tool-invocation";
          toolInvocation?: {
            toolName: string;
            args: Record<string, unknown>;
            result?: any;
            state?: "pending" | "streaming" | "result" | "error";
          };
        }) => {
          const result = toolPart.toolInvocation?.result;
          const appsSdkUri = result?._meta?.["openai/outputTemplate"];
          if (!appsSdkUri || typeof appsSdkUri !== "string" || !readResource)
            return;
          try {
            const resourceData = await readResource(appsSdkUri);
            if (
              resourceData?.contents &&
              Array.isArray(resourceData.contents)
            ) {
              const mcpResources = resourceData.contents.map(
                (content: any) => ({ type: "resource", resource: content })
              );
              toolPart.toolInvocation!.result = {
                ...result,
                content: [...(result.content || []), ...mcpResources],
                structuredContent: result?.structuredContent || null,
              };
            }
          } catch (error) {
            console.error("Failed to fetch Apps SDK resource:", error);
          }
        };

        for await (const ev of runToolLoop({
          config: {
            provider: llmConfig.provider,
            model: llmConfig.model,
            apiKey: llmConfig.apiKey,
            temperature: llmConfig.temperature,
          },
          messages: providerMessages,
          tools: toolList,
          callTool: async (name, args) => {
            return await connection.callTool(name, args, {
              signal: abortControllerRef.current?.signal,
            });
          },
          maxSteps: 10,
          signal: abortControllerRef.current?.signal,
        })) {
          if (abortControllerRef.current?.signal.aborted) break;

          if (ev.type === "text-delta") {
            currentTextPart += ev.delta;
            const lastPart = parts[parts.length - 1];
            if (lastPart && lastPart.type === "text") {
              lastPart.text = currentTextPart;
            } else {
              parts.push({ type: "text", text: currentTextPart });
            }
            commitMessageParts();
          } else if (ev.type === "tool-call-start") {
            if (currentTextPart) currentTextPart = "";
            toolCallArgBuffers.set(ev.toolCallId, {
              name: ev.toolName,
              accumulatedJson: "",
            });
            parts.push({
              type: "tool-invocation",
              toolInvocation: {
                toolName: ev.toolName,
                args: {},
                state: "streaming",
                partialArgs: {},
              },
            });
            commitMessageParts();
          } else if (ev.type === "tool-call-args-delta") {
            const buf = toolCallArgBuffers.get(ev.toolCallId);
            if (buf) {
              buf.accumulatedJson += ev.argsDelta;
              const partial = tryParseArgs(buf.accumulatedJson);
              if (partial) {
                const toolPart = parts.find(
                  (p) =>
                    p.type === "tool-invocation" &&
                    p.toolInvocation?.state === "streaming" &&
                    p.toolInvocation?.toolName === buf.name
                );
                if (toolPart && toolPart.toolInvocation) {
                  const prev = toolPart.toolInvocation.partialArgs;
                  const prevKeys = prev ? Object.keys(prev) : [];
                  const newKeys = Object.keys(partial);
                  const prevTotal = prevKeys.reduce(
                    (s, k) => s + String(prev![k] ?? "").length,
                    0
                  );
                  const newTotal = newKeys.reduce(
                    (s, k) => s + String(partial[k] ?? "").length,
                    0
                  );
                  if (
                    newKeys.length > prevKeys.length ||
                    newTotal >= prevTotal
                  ) {
                    toolPart.toolInvocation.partialArgs = partial;
                  }
                  commitMessageParts();
                  await maybeYield();
                }
              }
            }
          } else if (ev.type === "tool-call-ready") {
            toolCallsCount++;
            if (currentTextPart) currentTextPart = "";
            const streamingPart = parts.find(
              (p) =>
                p.type === "tool-invocation" &&
                p.toolInvocation?.state === "streaming" &&
                p.toolInvocation?.toolName === ev.toolName
            );
            if (streamingPart && streamingPart.toolInvocation) {
              streamingPart.toolInvocation.args = ev.args;
              streamingPart.toolInvocation.state = "pending";
            } else {
              parts.push({
                type: "tool-invocation",
                toolInvocation: {
                  toolName: ev.toolName,
                  args: ev.args,
                  state: "pending",
                },
              });
            }
            commitMessageParts();
          } else if (ev.type === "tool-result") {
            const toolPart = parts.find(
              (p) =>
                p.type === "tool-invocation" &&
                p.toolInvocation?.toolName === ev.toolName &&
                !p.toolInvocation?.result
            );
            if (toolPart && toolPart.toolInvocation) {
              toolPart.toolInvocation.result = ev.result;
              toolPart.toolInvocation.state =
                ev.isError || (ev.result as any)?.isError ? "error" : "result";
              await maybeFetchAppsSdkResource(toolPart);
              commitMessageParts();
            }
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
        }

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

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, parts: [...parts], content: "" }
              : msg
          )
        );

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
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("Client-side agent error:", error);

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
    [
      connection,
      llmConfig,
      isConnected,
      messages,
      readResource,
      attachments,
      disabledTools,
      widgetModelContexts,
    ]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
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
    setMessages,
    stop,
    addAttachment,
    removeAttachment,
    clearAttachments,
  };
}
