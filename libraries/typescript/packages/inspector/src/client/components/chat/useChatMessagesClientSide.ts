import { MCPChatMessageEvent, captureInspectorEvent } from "@/client/telemetry";
import {
  MCPAgent,
  providerConfigFromOptions,
  type McpConnectionLike,
} from "@mcp-use/agent";
import {
  isOAuthInteractionRequired,
  type McpServer,
  type Skill,
} from "@mcp-use/client/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import {
  convertMessagesToProvider,
  convertPromptResultsToMessages,
} from "./conversion";
import type {
  LLMConfig,
  Message,
  MessageAttachment,
  SendMessageOptions,
} from "./types";
import { fileToAttachment, isValidTotalSize } from "./utils";
import {
  appendTraceEvent,
  EMPTY_TRACE_STATE,
  type InspectorTraceEvent,
  type InspectorTraceEventInput,
} from "./trace";
import { DEFAULT_CHAT_SYSTEM_PROMPT } from "./system-prompt-default";
import {
  isManagedLlmConfig,
  managedNoticeFromLlmError,
  type ManagedChatNotice,
} from "./managedChatNotice";
import { parsePartialToolArgs } from "./partialToolArgs";
import {
  serializeWidgetModelContexts,
  widgetModelContextProviderMessage,
  type WidgetModelContext,
} from "./widget-model-context";
import {
  buildSkillSystemContext,
  createSkillContextConnection,
} from "./skill-context";
import {
  clearPendingChatTurn,
  readPendingChatTurn,
  savePendingChatTurn,
  type PendingChatTurn,
} from "./chat-auth-retry";

// Type alias for backward compatibility
type MCPConnection = McpServer;

interface UseChatMessagesClientSideProps {
  connection: MCPConnection;
  llmConfig: LLMConfig | null;
  isConnected: boolean;
  readResource?: (uri: string) => Promise<any>;
  widgetModelContexts?: Map<string, WidgetModelContext | undefined>;
  disabledTools?: Set<string>;
  appToolConnections?: McpConnectionLike[];
  initialMessages?: Message[];
  systemPrompt?: string;
  skills?: Skill[];
}

export function useChatMessagesClientSide({
  connection,
  llmConfig,
  isConnected,
  readResource,
  widgetModelContexts,
  disabledTools,
  appToolConnections,
  initialMessages,
  systemPrompt = DEFAULT_CHAT_SYSTEM_PROMPT,
  skills = [],
}: UseChatMessagesClientSideProps) {
  const retryServerId = connection.id ?? connection.url;
  const [initialPendingTurn] = useState(() =>
    readPendingChatTurn(retryServerId)
  );
  const [messages, setMessages] = useState<Message[]>(
    () => initialPendingTurn?.baseMessages ?? initialMessages ?? []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [traceState, setTraceState] = useState(EMPTY_TRACE_STATE);
  const [managedChatNotice, setManagedChatNotice] =
    useState<ManagedChatNotice | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sendInProgressRef = useRef(false);
  const traceIdRef = useRef(0);
  const initialPendingTurnRef = useRef(initialPendingTurn);
  const authorizationGateRef = useRef<{
    toolCallId: string;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const [pendingAuthorization, setPendingAuthorization] = useState<{
    toolCallId: string;
    replay: Omit<PendingChatTurn, "savedAt">;
  } | null>(null);
  const [authenticatingToolCallId, setAuthenticatingToolCallId] = useState<
    string | null
  >(null);
  const [toolAuthorizationError, setToolAuthorizationError] = useState<
    string | null
  >(null);

  const recordTrace = useCallback((event: InspectorTraceEventInput) => {
    const next = {
      ...event,
      id: `trace-${++traceIdRef.current}`,
      timestamp: Date.now(),
    } as InspectorTraceEvent;
    setTraceState((state) => appendTraceEvent(state, next));
  }, []);

  useEffect(() => {
    if (initialPendingTurnRef.current) return;
    if (initialMessages !== undefined) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  const sendMessage = useCallback(
    async (
      userInput: string,
      promptResults: PromptResult[],
      extraAttachments?: MessageAttachment[],
      options?: SendMessageOptions
    ) => {
      const isResuming = options?.resumeExistingTurn === true;
      const allAttachments = isResuming
        ? (extraAttachments ?? [])
        : [...attachments, ...(extraAttachments ?? [])];
      const hasContent =
        userInput.trim() ||
        promptResults.length > 0 ||
        allAttachments.length > 0;
      const rejectOrReturn = (message: string) => {
        if (options?.throwOnError) {
          throw new Error(message);
        }
      };
      if (!hasContent) {
        rejectOrReturn("Chat message must include content");
        return;
      }
      if (!llmConfig) {
        rejectOrReturn("Chat is not configured");
        return;
      }
      if (!isConnected) {
        rejectOrReturn("The MCP server is not connected");
        return;
      }
      if (sendInProgressRef.current) {
        rejectOrReturn("Chat is busy with another turn");
        return;
      }
      sendInProgressRef.current = true;

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

      const baseMessages = isResuming
        ? messages
        : [...messages, ...userMessages];
      if (!isResuming) {
        setMessages(baseMessages);
      }
      setIsLoading(true);
      setAttachments([]);

      abortControllerRef.current = new AbortController();
      const startTime = Date.now();
      let toolCallsCount = 0;
      const assistantMessageId = `assistant-${Date.now()}`;

      try {
        let accepted = false;
        const markAccepted = () => {
          if (accepted) return;
          accepted = true;
          options?.onAccepted?.();
        };
        let currentTextPart = "";
        const parts: Array<{
          type: "text" | "tool-invocation";
          text?: string;
          toolInvocation?: {
            toolCallId: string;
            toolName: string;
            args: Record<string, unknown>;
            result?: any;
            state?:
              | "pending"
              | "streaming"
              | "authorization-required"
              | "result"
              | "error";
            partialArgs?: Record<string, unknown>;
          };
        }> = [];

        // Per-tool-call accumulated JSON for partial-args rendering.
        const toolCallArgBuffers = new Map<
          string,
          { accumulatedJson: string }
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

        const historyMessages = baseMessages;

        const serializedWidgetContext = serializeWidgetModelContexts(
          widgetModelContexts ?? new Map()
        );
        const widgetContextMessage = widgetModelContextProviderMessage(
          serializedWidgetContext
        );
        const providerMessages = [
          ...(widgetContextMessage ? [widgetContextMessage] : []),
          ...convertMessagesToProvider(historyMessages),
        ];
        recordTrace({
          type: "request",
          request: {
            provider: llmConfig.provider,
            model: llmConfig.model,
            messages: providerMessages,
          },
        });

        const skillConnection = createSkillContextConnection({
          skills,
          origin:
            connection.displayName ?? connection.url ?? "connected MCP server",
          getSkill: connection.getSkill,
          readResource: connection.readResource,
        });
        const commitMessageParts = () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, parts: [...parts] }
                : msg
            )
          );
        };
        const replayTurn: Omit<PendingChatTurn, "savedAt"> = {
          serverId: retryServerId,
          userInput,
          promptResults,
          attachments: allAttachments,
          baseMessages,
        };
        const authAwareConnection: MCPConnection = {
          ...connection,
          callTool: async (toolName, args) => {
            let authorizationAttempts = 0;
            while (true) {
              try {
                return await connection.callTool(toolName, args);
              } catch (error) {
                if (
                  !isOAuthInteractionRequired(error) ||
                  authorizationAttempts >= 1
                ) {
                  throw error;
                }
                authorizationAttempts++;

                const toolPart = [...parts]
                  .reverse()
                  .find(
                    (part) =>
                      part.type === "tool-invocation" &&
                      part.toolInvocation?.toolName === toolName &&
                      part.toolInvocation.state === "pending"
                  );
                const toolCallId = toolPart?.toolInvocation?.toolCallId;
                if (!toolPart?.toolInvocation || !toolCallId) throw error;

                toolPart.toolInvocation.state = "authorization-required";
                setPendingAuthorization({ toolCallId, replay: replayTurn });
                setToolAuthorizationError(null);
                commitMessageParts();

                await new Promise<void>((resolve, reject) => {
                  const signal = abortControllerRef.current?.signal;
                  const handleAbort = () => {
                    if (
                      authorizationGateRef.current?.toolCallId === toolCallId
                    ) {
                      authorizationGateRef.current = null;
                    }
                    reject(
                      new DOMException("Chat turn was cancelled", "AbortError")
                    );
                  };
                  const cleanup = () =>
                    signal?.removeEventListener("abort", handleAbort);
                  authorizationGateRef.current = {
                    toolCallId,
                    resolve: () => {
                      cleanup();
                      resolve();
                    },
                    reject: (gateError) => {
                      cleanup();
                      reject(gateError);
                    },
                  };
                  signal?.addEventListener("abort", handleAbort, {
                    once: true,
                  });
                });

                toolPart.toolInvocation.state = "pending";
                setPendingAuthorization(null);
                setToolAuthorizationError(null);
                clearPendingChatTurn(retryServerId);
                commitMessageParts();
              }
            }
          },
        };
        const agent = new MCPAgent({
          llm: providerConfigFromOptions(llmConfig.provider, llmConfig.model, {
            apiKey: llmConfig.apiKey,
            temperature: llmConfig.temperature,
            baseUrl: llmConfig.baseUrl,
            credentials: llmConfig.credentials,
          }),
          mcpServers: [
            ...(skillConnection ? [skillConnection] : []),
            authAwareConnection,
            ...(appToolConnections ?? []),
          ],
          systemPrompt: `${systemPrompt}${buildSkillSystemContext(
            skills,
            connection.displayName ?? connection.url ?? "connected MCP server"
          )}`,
          disallowedTools:
            disabledTools && disabledTools.size > 0
              ? [...disabledTools].sort()
              : undefined,
          maxSteps: 10,
          autoInitialize: true,
        });

        for await (const ev of agent.streamEvents({
          messages: providerMessages,
          signal: abortControllerRef.current?.signal,
        })) {
          markAccepted();
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
              accumulatedJson: "",
            });
            parts.push({
              type: "tool-invocation",
              toolInvocation: {
                toolCallId: ev.toolCallId,
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
              const partial = parsePartialToolArgs(buf.accumulatedJson);
              if (partial) {
                const toolPart = parts.find(
                  (p) =>
                    p.type === "tool-invocation" &&
                    p.toolInvocation?.state === "streaming" &&
                    p.toolInvocation?.toolCallId === ev.toolCallId
                );
                if (toolPart && toolPart.toolInvocation) {
                  toolPart.toolInvocation.partialArgs = partial;
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
                p.toolInvocation?.toolCallId === ev.toolCallId
            );
            if (streamingPart && streamingPart.toolInvocation) {
              streamingPart.toolInvocation.args = ev.args;
              streamingPart.toolInvocation.state = "pending";
              streamingPart.toolInvocation.partialArgs = undefined;
            } else {
              parts.push({
                type: "tool-invocation",
                toolInvocation: {
                  toolCallId: ev.toolCallId,
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
                p.toolInvocation?.toolCallId === ev.toolCallId &&
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
              (part.toolInvocation?.state === "pending" ||
                part.toolInvocation?.state === "streaming")
            ) {
              part.toolInvocation.state = "error";
              part.toolInvocation.result = "Cancelled by user";
            }
          }
        }
        markAccepted();

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
          ).catch(() => {
            // Silently fail - telemetry should not break the application
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          if (options?.throwOnError) {
            throw new Error("Chat turn was cancelled");
          }
          return;
        }

        const notice = isManagedLlmConfig(llmConfig)
          ? managedNoticeFromLlmError(error)
          : null;
        if (notice) {
          setManagedChatNotice(notice);
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantMessageId)
          );
          if (options?.throwOnError) {
            throw new Error("Chat request could not be completed");
          }
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
          ).catch(() => {
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
        if (options?.throwOnError) {
          throw new Error(errorDetail);
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        sendInProgressRef.current = false;
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
      appToolConnections,
      widgetModelContexts,
      recordTrace,
      retryServerId,
      systemPrompt,
      skills,
    ]
  );

  const authenticatePendingTool = useCallback(
    async (toolCallId: string) => {
      if (
        pendingAuthorization?.toolCallId !== toolCallId ||
        authenticatingToolCallId
      ) {
        return;
      }

      savePendingChatTurn(pendingAuthorization.replay);
      setAuthenticatingToolCallId(toolCallId);
      setToolAuthorizationError(null);
      try {
        await connection.authenticate();
        const gate = authorizationGateRef.current;
        if (gate?.toolCallId === toolCallId) {
          authorizationGateRef.current = null;
          gate.resolve();
        }
      } catch (error) {
        clearPendingChatTurn(retryServerId);
        setToolAuthorizationError(
          error instanceof Error ? error.message : "Authentication failed"
        );
      } finally {
        setAuthenticatingToolCallId(null);
      }
    },
    [authenticatingToolCallId, connection, pendingAuthorization, retryServerId]
  );

  useEffect(() => {
    const pendingTurn = initialPendingTurnRef.current;
    if (!pendingTurn || !isConnected || !llmConfig) return;

    initialPendingTurnRef.current = null;
    clearPendingChatTurn(retryServerId);
    setMessages(pendingTurn.baseMessages);
    void sendMessage(
      pendingTurn.userInput,
      pendingTurn.promptResults,
      pendingTurn.attachments,
      { resumeExistingTurn: true }
    );
  }, [isConnected, llmConfig, retryServerId, sendMessage]);

  const clearMessages = useCallback(() => {
    clearPendingChatTurn(retryServerId);
    authorizationGateRef.current?.reject(
      new DOMException("Chat turn was cancelled", "AbortError")
    );
    authorizationGateRef.current = null;
    setPendingAuthorization(null);
    setAuthenticatingToolCallId(null);
    setToolAuthorizationError(null);
    setMessages([]);
    setTraceState(EMPTY_TRACE_STATE);
    setManagedChatNotice(null);
  }, [retryServerId]);
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

  const clearManagedChatNotice = useCallback(() => {
    setManagedChatNotice(null);
  }, []);

  const showManagedChatNotice = useCallback((notice: ManagedChatNotice) => {
    setManagedChatNotice(notice);
  }, []);

  return {
    messages,
    isLoading,
    attachments,
    managedChatNotice,
    sendMessage,
    clearMessages,
    clearManagedChatNotice,
    showManagedChatNotice,
    setMessages,
    stop,
    addAttachment,
    removeAttachment,
    clearAttachments,
    clearTrace,
    traceEvents: traceState.events,
    tokenUsage: traceState.usage,
    pendingAuthorization,
    authenticatePendingTool,
    authenticatingToolCallId,
    toolAuthorizationError,
  };
}
