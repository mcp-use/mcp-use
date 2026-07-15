import { MCPChatMessageEvent, captureInspectorEvent } from "@/client/telemetry";
import { MCPAgent, providerConfigFromOptions } from "@mcp-use/agent";
import type { McpServer } from "@mcp-use/client/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import {
  convertMessagesToProvider,
  convertPromptResultsToMessages,
} from "./conversion";
import type { LLMConfig, Message, MessageAttachment } from "./types";
import { fileToAttachment, isValidTotalSize } from "./utils";
import {
  appendTraceEvent,
  EMPTY_TRACE_STATE,
  type InspectorTraceEvent,
  type InspectorTraceEventInput,
} from "./trace";
import { DEFAULT_CHAT_SYSTEM_PROMPT } from "./system-prompt-default";

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
  initialMessages?: Message[];
  systemPrompt?: string;
}

export function useChatMessagesClientSide({
  connection,
  llmConfig,
  isConnected,
  readResource,
  widgetModelContexts,
  disabledTools,
  initialMessages,
  systemPrompt = DEFAULT_CHAT_SYSTEM_PROMPT,
}: UseChatMessagesClientSideProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [traceState, setTraceState] = useState(EMPTY_TRACE_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);
  const traceIdRef = useRef(0);

  const recordTrace = useCallback(
    (event: InspectorTraceEventInput) => {
      const next = {
        ...event,
        id: `trace-${++traceIdRef.current}`,
        timestamp: Date.now(),
      } as InspectorTraceEvent;
      setTraceState((state) => appendTraceEvent(state, next));
    },
    []
  );

  useEffect(() => {
    if (initialMessages !== undefined) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

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
        recordTrace({
          type: "request",
          request: {
            provider: llmConfig.provider,
            model: llmConfig.model,
            messages: providerMessages,
          },
        });

        const agent = new MCPAgent({
          llm: providerConfigFromOptions(
            llmConfig.provider,
            llmConfig.model,
            {
              apiKey: llmConfig.apiKey,
              temperature: llmConfig.temperature,
              baseUrl: llmConfig.baseUrl,
            }
          ),
          mcpServers: [connection],
          systemPrompt,
          disallowedTools: disabledTools ? [...disabledTools] : undefined,
          maxSteps: 10,
          autoInitialize: true,
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

        for await (const ev of agent.streamEvents({
          messages: providerMessages,
          signal: abortControllerRef.current?.signal,
        })) {
          if (abortControllerRef.current?.signal.aborted) break;

          // Keep inspector compatible with an older installed agent build while
          // the additive usage event rolls through workspace package outputs.
          if ((ev as { type: string }).type === "usage") {
            const usageEvent = ev as unknown as {
              type: "usage";
              usage: import("./trace").InspectorTokenUsage;
            };
            recordTrace({
              type: "usage",
              usage: usageEvent.usage,
              raw: usageEvent,
            });
            continue;
          }

          if (ev.type === "text-delta") {
            recordTrace({ type: "text-delta", delta: ev.delta, raw: ev });
            currentTextPart += ev.delta;
            const lastPart = parts[parts.length - 1];
            if (lastPart && lastPart.type === "text") {
              lastPart.text = currentTextPart;
            } else {
              parts.push({ type: "text", text: currentTextPart });
            }
            commitMessageParts();
          } else if (ev.type === "tool-call-start") {
            recordTrace({
              type: "tool-call-start",
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              raw: ev,
            });
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
            recordTrace({
              type: "tool-call-args",
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              args: ev.args,
              raw: ev,
            });
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
            recordTrace({
              type: "tool-result",
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              result: ev.result,
              isError: ev.isError,
              raw: ev,
            });
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
              commitMessageParts();
            }
          } else if (ev.type === "done") {
            recordTrace({ type: "done", raw: ev });
          } else if (ev.type === "error") {
            recordTrace({ type: "error", message: ev.message, raw: ev });
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
          captureInspectorEvent(
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
          captureInspectorEvent(
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
      recordTrace,
      systemPrompt,
    ]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setTraceState(EMPTY_TRACE_STATE);
  }, []);
  const clearTrace = useCallback(() => setTraceState(EMPTY_TRACE_STATE), []);

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
    clearTrace,
    traceEvents: traceState.events,
    tokenUsage: traceState.usage,
  };
}
