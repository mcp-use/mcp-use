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
import { useCallback, useEffect, useState, type SetStateAction } from "react";
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
import { createChatSessionId } from "./chat-session";
import {
  resolveStateAction,
  useChatSession,
  useChatSessionStore,
  type ChatSessionStore,
} from "./chat-session-store";

// Type alias for backward compatibility
type MCPConnection = McpServer;

// Chat history is optional. Give an in-flight creation a short chance to
// provide a backend-minted id for redirect recovery, but never let it prevent
// the user from starting OAuth indefinitely.
const CHAT_CREATION_AUTH_WAIT_MS = 1_000;

async function waitForPersistedChatId(
  creation: Promise<string | null>
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      creation,
      new Promise<null>((resolve) => {
        timeout = setTimeout(resolve, CHAT_CREATION_AUTH_WAIT_MS, null);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

interface UseChatMessagesClientSideProps {
  /** Store holding one record per chat session. Defaults to a private store. */
  sessionStore?: ChatSessionStore;
  /** Session this hook renders. Defaults to a single private session. */
  sessionId?: string;
  /** Fires for every session whose messages change, including background ones. */
  onMessagesChange?: (sessionId: string, messages: Message[]) => void;
  connection: MCPConnection;
  llmConfig: LLMConfig | null;
  isConnected: boolean;
  readResource?: (uri: string) => Promise<any>;
  widgetModelContexts?: Map<string, WidgetModelContext | undefined>;
  disabledTools?: Set<string>;
  appToolConnections?: McpConnectionLike[];
  /** Seeds the session on first use; a session already in the store is kept. */
  initialMessages?: Message[];
  systemPrompt?: string;
  skills?: Skill[];
}

export function useChatMessagesClientSide({
  sessionStore,
  sessionId,
  onMessagesChange,
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
  const privateStore = useChatSessionStore();
  const store = sessionStore ?? privateStore;
  const [privateSessionId] = useState(createChatSessionId);
  const activeSessionId = sessionId ?? privateSessionId;

  // Seeding is skipped once the session exists, so returning to a chat that is
  // still streaming never replaces the messages it is writing.
  if (initialMessages?.length && !store.has(activeSessionId)) {
    store.seed(activeSessionId, initialMessages);
  }

  const [session, updateSession] = useChatSession(store, activeSessionId);
  const {
    messages,
    isLoading,
    attachments,
    managedChatNotice,
    pendingAuthorization,
    authenticatingToolCallId,
    toolAuthorizationError,
    runtime,
  } = session;
  const traceState = session.trace;

  const setMessages = useCallback(
    (action: SetStateAction<Message[]>) => {
      const next = store.update(activeSessionId, (current) => ({
        messages: resolveStateAction(current.messages, action),
      }));
      onMessagesChange?.(activeSessionId, next.messages);
    },
    [activeSessionId, onMessagesChange, store]
  );
  const recordTrace = useCallback(
    (event: InspectorTraceEventInput) => {
      const next = {
        ...event,
        id: `trace-${++runtime.traceId}`,
        timestamp: Date.now(),
      } as InspectorTraceEvent;
      updateSession((current) => ({
        trace: appendTraceEvent(current.trace, next),
      }));
    },
    [runtime, updateSession]
  );

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
      if (runtime.sendInProgress) {
        rejectOrReturn("Chat is busy with another turn");
        return;
      }
      runtime.sendInProgress = true;

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
      updateSession({ isLoading: true, attachments: [] });

      runtime.abortController = new AbortController();
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
          sessionId: activeSessionId,
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
                updateSession({
                  pendingAuthorization: { toolCallId, replay: replayTurn },
                  toolAuthorizationError: null,
                });
                commitMessageParts();

                await new Promise<void>((resolve, reject) => {
                  const signal = runtime.abortController?.signal;
                  const handleAbort = () => {
                    if (runtime.authorizationGate?.toolCallId === toolCallId) {
                      runtime.authorizationGate = null;
                    }
                    reject(
                      new DOMException("Chat turn was cancelled", "AbortError")
                    );
                  };
                  const cleanup = () =>
                    signal?.removeEventListener("abort", handleAbort);
                  runtime.authorizationGate = {
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
                updateSession({
                  pendingAuthorization: null,
                  toolAuthorizationError: null,
                });
                clearPendingChatTurn(retryServerId, activeSessionId);
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
          signal: runtime.abortController?.signal,
        })) {
          markAccepted();
          if (runtime.abortController?.signal.aborted) break;

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

        if (runtime.abortController?.signal.aborted) {
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
          updateSession({ managedChatNotice: notice });
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
        updateSession({ isLoading: false });
        runtime.abortController = null;
        runtime.sendInProgress = false;
      }
    },
    [
      activeSessionId,
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
      runtime,
      systemPrompt,
      skills,
      setMessages,
      updateSession,
    ]
  );

  const authenticatePendingTool = useCallback(
    async (toolCallId: string) => {
      const currentSession = store.get(activeSessionId);
      const currentAuthorization = currentSession.pendingAuthorization;
      if (
        currentAuthorization?.toolCallId !== toolCallId ||
        currentSession.authenticatingToolCallId
      ) {
        return;
      }

      // Store updates are synchronous, so this is also the lock against rapid
      // repeated calls before React has had a chance to re-render.
      updateSession({
        authenticatingToolCallId: toolCallId,
        toolAuthorizationError: null,
      });
      try {
        const persistedChatId =
          currentSession.persistedChatId ??
          (currentSession.creation
            ? await waitForPersistedChatId(currentSession.creation)
            : null);
        savePendingChatTurn({
          ...currentAuthorization.replay,
          ...(persistedChatId ? { persistedChatId } : {}),
        });
        await connection.authenticate();
        const gate = runtime.authorizationGate;
        if (gate?.toolCallId === toolCallId) {
          runtime.authorizationGate = null;
          gate.resolve();
        }
      } catch (error) {
        clearPendingChatTurn(retryServerId, activeSessionId);
        updateSession({
          toolAuthorizationError:
            error instanceof Error ? error.message : "Authentication failed",
        });
      } finally {
        updateSession({ authenticatingToolCallId: null });
      }
    },
    [activeSessionId, connection, retryServerId, runtime, store, updateSession]
  );

  // A full-page OAuth redirect drops the turn that was in flight. The session it
  // belonged to is reactivated by whoever owns the store, so replay it here once
  // that session is connected again.
  useEffect(() => {
    if (runtime.pendingTurnResumed || !isConnected || !llmConfig) return;
    runtime.pendingTurnResumed = true;

    const pendingTurn = readPendingChatTurn(retryServerId, activeSessionId);
    if (!pendingTurn) return;

    clearPendingChatTurn(retryServerId, activeSessionId);
    setMessages(pendingTurn.baseMessages);
    void sendMessage(
      pendingTurn.userInput,
      pendingTurn.promptResults,
      pendingTurn.attachments,
      { resumeExistingTurn: true }
    );
  }, [
    activeSessionId,
    isConnected,
    llmConfig,
    retryServerId,
    runtime,
    sendMessage,
    setMessages,
  ]);

  const clearMessages = useCallback(() => {
    runtime.pendingTurnResumed = true;
    clearPendingChatTurn(retryServerId, activeSessionId);
    runtime.authorizationGate?.reject(
      new DOMException("Chat turn was cancelled", "AbortError")
    );
    runtime.authorizationGate = null;
    setMessages([]);
    updateSession({
      pendingAuthorization: null,
      authenticatingToolCallId: null,
      toolAuthorizationError: null,
      trace: EMPTY_TRACE_STATE,
      managedChatNotice: null,
    });
  }, [activeSessionId, retryServerId, runtime, setMessages, updateSession]);
  const clearTrace = useCallback(
    () => updateSession({ trace: EMPTY_TRACE_STATE }),
    [updateSession]
  );

  const stop = useCallback(() => {
    runtime.abortController?.abort();
  }, [runtime]);

  const addAttachment = useCallback(
    async (file: File) => {
      try {
        const attachment = await fileToAttachment(file);

        updateSession((current) => {
          const newAttachments = [...current.attachments, attachment];
          if (!isValidTotalSize(newAttachments)) {
            alert("Total attachment size exceeds 20MB limit");
            return {};
          }
          return { attachments: newAttachments };
        });
      } catch (error) {
        if (error instanceof Error) {
          alert(error.message);
        } else {
          alert("Failed to add attachment");
        }
      }
    },
    [updateSession]
  );

  const removeAttachment = useCallback(
    (index: number) => {
      updateSession((current) => ({
        attachments: current.attachments.filter((_, i) => i !== index),
      }));
    },
    [updateSession]
  );

  const clearAttachments = useCallback(() => {
    updateSession({ attachments: [] });
  }, [updateSession]);

  const clearManagedChatNotice = useCallback(() => {
    updateSession({ managedChatNotice: null });
  }, [updateSession]);

  const showManagedChatNotice = useCallback(
    (notice: ManagedChatNotice) => {
      updateSession({ managedChatNotice: notice });
    },
    [updateSession]
  );

  return {
    sessionId: activeSessionId,
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
