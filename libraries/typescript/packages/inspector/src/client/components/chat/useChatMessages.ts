import { useCallback, useState, type SetStateAction } from "react";
import { inspectorApi } from "@/client/utils/basePath";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import {
  convertMessagesToProvider,
  convertPromptResultsToMessages,
} from "./conversion";
import type {
  AuthConfig,
  ChatBodyBuilder,
  LLMConfig,
  Message,
  MessageAttachment,
  SendMessageOptions,
  StreamProtocol,
} from "./types";
import { fileToAttachment, hashString, isValidTotalSize } from "./utils";
import {
  appendTraceEvent,
  EMPTY_TRACE_STATE,
  inspectorTokenUsageFromUnknown,
  redactSensitiveRequestFields,
  type InspectorTraceEvent,
  type InspectorTraceEventInput,
} from "./trace";
import {
  isCloudFetchFailure,
  managedNoticeFromHttpResponse,
  type ManagedChatNotice,
} from "./managedChatNotice";
import { parsePartialToolArgs } from "./partialToolArgs";
import {
  serializeWidgetModelContexts,
  widgetModelContextProviderMessage,
  type WidgetModelContext,
} from "./widget-model-context";
import { createChatSessionId } from "./chat-session";
import {
  resolveStateAction,
  useChatSession,
  useChatSessionField,
  useChatSessionStore,
  type ChatSessionStore,
} from "./chat-session-store";

interface UseChatMessagesProps {
  /** Store holding one record per chat session. Defaults to a private store. */
  sessionStore?: ChatSessionStore;
  /** Session this hook renders. Defaults to a single private session. */
  sessionId?: string;
  /** Fires for every session whose messages change, including background ones. */
  onMessagesChange?: (sessionId: string, messages: Message[]) => void;
  mcpServerUrl: string;
  llmConfig: LLMConfig | null;
  authConfig: AuthConfig | null;
  /** Live OAuth tokens from the active MCP connection (preferred over saved authConfig). */
  mcpAuthTokens?: AuthConfig["oauthTokens"];
  isConnected: boolean;
  /** Custom API endpoint URL for chat streaming. Defaults to "/inspector/api/chat/stream". */
  chatApiUrl?: string;
  /** When chatApiUrl is not yet available, called before sending to resolve the URL. Useful for background initialization. */
  waitForChatApiUrl?: () => Promise<string | undefined>;
  /** Active widget model contexts to inject into the LLM conversation */
  widgetModelContexts?: Map<string, WidgetModelContext | undefined>;
  /** Seeds the session on first use; a session already in the store is kept. */
  initialMessages?: Message[];
  /** Tool names the user has disabled via the tool selector. Sent to the server so it can exclude them. */
  disabledTools?: Set<string>;
  /**
   * Wire protocol used by the streaming endpoint.
   * - `"sse"` (default): Inspector SSE protocol (`data: {"type":"text","content":"..."}\n\n`)
   * - `"data-stream"`: Vercel AI SDK data-stream protocol (`0:"text"`, `9:{...}`, etc.)
   */
  streamProtocol?: StreamProtocol;
  /** Credentials policy for the fetch request (e.g. `"include"` for cross-origin cookie auth). */
  credentials?: RequestCredentials;
  /** Extra headers to send with every streaming request. */
  extraHeaders?: Record<string, string>;
  /**
   * Custom body builder. Receives the serialised messages array and returns the
   * object that will be JSON-stringified as the request body.
   * When omitted, the default body includes `mcpServerUrl`, `llmConfig`,
   * `authConfig`, and `messages`.
   * The second argument contains the effective disabled tools and serialized
   * scoped widget context.
   */
  body?: ChatBodyBuilder;
}

export function useChatMessages({
  sessionStore,
  sessionId,
  onMessagesChange,
  mcpServerUrl,
  llmConfig,
  authConfig,
  mcpAuthTokens,
  isConnected,
  chatApiUrl,
  waitForChatApiUrl,
  widgetModelContexts,
  initialMessages,
  disabledTools,
  streamProtocol = "sse",
  credentials,
  extraHeaders,
  body: bodyBuilder,
}: UseChatMessagesProps) {
  const privateStore = useChatSessionStore();
  const store = sessionStore ?? privateStore;
  const [privateSessionId] = useState(createChatSessionId);
  const activeSessionId = sessionId ?? privateSessionId;

  // Seeding is skipped once the session exists, so returning to a chat that is
  // still streaming never replaces the messages it is writing.
  if (initialMessages?.length && !store.has(activeSessionId)) {
    store.seed(activeSessionId, initialMessages);
  }

  const session = useChatSession(store, activeSessionId);
  const {
    messages,
    isLoading,
    attachments,
    managedChatNotice,
    mcpServerAuthRequired,
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
  const setIsLoading = useChatSessionField(store, activeSessionId, "isLoading");
  const setAttachments = useChatSessionField(
    store,
    activeSessionId,
    "attachments"
  );
  const setTraceState = useChatSessionField(store, activeSessionId, "trace");
  const setManagedChatNotice = useChatSessionField(
    store,
    activeSessionId,
    "managedChatNotice"
  );
  const setMcpServerAuthRequired = useChatSessionField(
    store,
    activeSessionId,
    "mcpServerAuthRequired"
  );

  const recordTrace = useCallback(
    (event: InspectorTraceEventInput) => {
      const next = {
        ...event,
        id: `trace-${++runtime.traceId}`,
        timestamp: Date.now(),
      } as InspectorTraceEvent;
      setTraceState((state) => appendTraceEvent(state, next));
    },
    [runtime, setTraceState]
  );

  const sendMessage = useCallback(
    async (
      userInput: string,
      promptResults: PromptResult[],
      extraAttachments?: MessageAttachment[],
      options?: SendMessageOptions
    ) => {
      const allAttachments = [...attachments, ...(extraAttachments ?? [])];
      // Can send if there's text, prompt results, or attachments
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

      // Only create a user message if there's actual user input or user-uploaded attachments
      // Don't create one when only using prompt results (they create their own messages)
      const userMessages: Message[] = [...promptResultsMessages];

      if (userInput.trim() || allAttachments.length > 0) {
        const userMessage: Message = {
          id: `user-${Date.now()}`,
          role: "user",
          content: userInput.trim(),
          timestamp: Date.now(),
          attachments: allAttachments.length > 0 ? allAttachments : undefined,
        };
        userMessages.push(userMessage);
      }

      setMessages((prev) => [...prev, ...userMessages]);
      setIsLoading(true);

      // Clear attachments after sending
      setAttachments([]);

      // Create abort controller for cancellation
      runtime.abortController = new AbortController();

      try {
        // Server-side chat must forward the same OAuth credentials as the browser
        // MCP connection. Saved authConfig often stays "none" after BYOK setup.
        let authConfigWithTokens = authConfig;
        const hasExplicitBearer =
          authConfig?.type === "bearer" && Boolean(authConfig.token);
        const hasExplicitBasic =
          authConfig?.type === "basic" &&
          Boolean(authConfig.username || authConfig.password);

        if (!hasExplicitBearer && !hasExplicitBasic) {
          if (mcpAuthTokens?.access_token) {
            authConfigWithTokens = {
              type: "oauth",
              oauthTokens: mcpAuthTokens,
            };
          } else {
            try {
              const storageKeyPrefix = "mcp:auth";
              const serverUrlHash = hashString(mcpServerUrl);
              const storageKey = `${storageKeyPrefix}_${serverUrlHash}_tokens`;
              const tokensStr = localStorage.getItem(storageKey);
              if (tokensStr) {
                const tokens = JSON.parse(
                  tokensStr
                ) as AuthConfig["oauthTokens"];
                if (tokens?.access_token) {
                  authConfigWithTokens = { type: "oauth", oauthTokens: tokens };
                }
              }
            } catch (error) {
              console.warn("Failed to retrieve OAuth tokens:", error);
            }
          }
        }

        const historyMessages = [...messages, ...userMessages];
        const serializedWidgetContext = serializeWidgetModelContexts(
          widgetModelContexts ?? new Map()
        );
        const widgetContextMessage = widgetModelContextProviderMessage(
          serializedWidgetContext
        );
        const serialisedMessages = [
          ...(widgetContextMessage ? [widgetContextMessage] : []),
          ...historyMessages.map((m) => ({
            role: m.role,
            content:
              m.content ||
              (m.parts
                ?.filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("") ??
                ""),
            attachments: m.attachments,
          })),
        ];
        const resolvedUrl =
          chatApiUrl ??
          (waitForChatApiUrl ? await waitForChatApiUrl() : undefined) ??
          inspectorApi("chat/stream");

        const disabledToolNames = [...(disabledTools ?? [])].sort();
        const bodyContext = {
          disabledTools: disabledToolNames,
          ...(serializedWidgetContext
            ? { widgetModelContext: serializedWidgetContext }
            : {}),
        };
        const requestBody = bodyBuilder
          ? bodyBuilder(serialisedMessages, bodyContext)
          : {
              mcpServerUrl,
              llmConfig,
              authConfig: authConfigWithTokens,
              messages: serialisedMessages,
              ...(disabledToolNames.length > 0
                ? { disabledTools: disabledToolNames }
                : {}),
            };
        const requestEnvelope = bodyBuilder
          ? redactSensitiveRequestFields(requestBody)
          : {
              mcpServerUrl,
              llmConfig: {
                provider: llmConfig.provider,
                model: llmConfig.model,
                temperature: llmConfig.temperature,
                baseUrl: llmConfig.baseUrl,
              },
              messages: serialisedMessages,
              ...(disabledToolNames.length > 0
                ? { disabledTools: disabledToolNames }
                : {}),
            };
        recordTrace({
          type: "request",
          request: {
            url: resolvedUrl,
            protocol: streamProtocol,
            envelope: requestEnvelope,
            providerMessages: [
              ...(widgetContextMessage ? [widgetContextMessage] : []),
              ...convertMessagesToProvider(historyMessages),
            ],
          },
        });

        const response = await fetch(resolvedUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...extraHeaders,
          },
          signal: runtime.abortController.signal,
          ...(credentials ? { credentials } : {}),
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => null);
          if (chatApiUrl) {
            const notice = managedNoticeFromHttpResponse(
              response.status,
              errBody
            );
            if (notice) {
              setManagedChatNotice(notice);
              if (options?.throwOnError) {
                throw new Error(
                  `Chat request failed with HTTP ${response.status}`
                );
              }
              return;
            }
          }
          if (response.status === 401) {
            if (errBody?.error === "mcp_auth_required") {
              setMcpServerAuthRequired({
                mcpServerUrl:
                  (errBody.mcpServerUrl as string | undefined) ?? mcpServerUrl,
                message: errBody.message as string | undefined,
              });
              if (options?.throwOnError) {
                throw new Error("The MCP server requires authentication");
              }
              return;
            }
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        options?.onAccepted?.();

        // Create assistant message that will be updated with streaming content
        const assistantMessageId = `assistant-${Date.now()}`;
        let currentTextPart = "";
        const parts: Array<{
          type: "text" | "tool-invocation";
          text?: string;
          toolInvocation?: {
            toolCallId: string;
            toolName: string;
            args: Record<string, unknown>;
            result?: any;
            state?: "pending" | "streaming" | "result" | "error";
            partialArgs?: Record<string, unknown>;
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

        // Shared helpers for updating the assistant message parts
        const updateParts = () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, parts: [...parts] }
                : msg
            )
          );
        };
        const finalizeParts = () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, parts: [...parts], content: "" }
                : msg
            )
          );
        };
        const appendText = (text: string) => {
          currentTextPart += text;
          const lastPart = parts[parts.length - 1];
          if (lastPart && lastPart.type === "text") {
            lastPart.text = currentTextPart;
          } else {
            parts.push({ type: "text", text: currentTextPart });
          }
          updateParts();
        };
        // Streaming protocol state shared by data-stream and Inspector SSE.
        const toolCallIdToIndex = new Map<string, number>();
        const toolCallArgBuffers = new Map<string, string>();

        const appendToolCallStart = (toolCallId: string, toolName: string) => {
          if (currentTextPart) currentTextPart = "";
          if (toolCallIdToIndex.has(toolCallId)) return;
          parts.push({
            type: "tool-invocation",
            toolInvocation: {
              toolCallId,
              toolName,
              args: {},
              state: "streaming",
              partialArgs: {},
            },
          });
          toolCallIdToIndex.set(toolCallId, parts.length - 1);
          toolCallArgBuffers.set(toolCallId, "");
          updateParts();
        };
        const appendToolCallDelta = (toolCallId: string, argsDelta: string) => {
          const idx = toolCallIdToIndex.get(toolCallId);
          if (idx === undefined || !argsDelta) return;
          const accumulated =
            (toolCallArgBuffers.get(toolCallId) ?? "") + argsDelta;
          toolCallArgBuffers.set(toolCallId, accumulated);
          const partialArgs = parsePartialToolArgs(accumulated);
          const invocation = parts[idx]?.toolInvocation;
          if (!partialArgs || !invocation) return;
          invocation.partialArgs = partialArgs;
          updateParts();
        };
        const appendToolCall = (
          toolCallId: string,
          toolName: string,
          args: Record<string, unknown>
        ) => {
          if (currentTextPart) currentTextPart = "";
          const existingIndex = toolCallIdToIndex.get(toolCallId);
          const existingInvocation =
            existingIndex === undefined
              ? undefined
              : parts[existingIndex]?.toolInvocation;
          if (existingInvocation) {
            existingInvocation.toolName = toolName;
            existingInvocation.args = args;
            existingInvocation.state = "pending";
            existingInvocation.partialArgs = undefined;
          } else {
            parts.push({
              type: "tool-invocation",
              toolInvocation: {
                toolCallId,
                toolName,
                args,
                state: "pending",
              },
            });
            toolCallIdToIndex.set(toolCallId, parts.length - 1);
          }
          toolCallArgBuffers.delete(toolCallId);
          updateParts();
        };
        const resolveToolResult = (
          match:
            | { by: "toolName"; toolName: string }
            | { by: "index"; index: number },
          result: unknown
        ) => {
          let toolPart: (typeof parts)[number] | undefined;
          if (match.by === "toolName") {
            toolPart = parts.find(
              (p) =>
                p.type === "tool-invocation" &&
                p.toolInvocation?.toolName === match.toolName &&
                !p.toolInvocation?.result
            );
          } else {
            toolPart = parts[match.index];
          }
          if (toolPart?.toolInvocation) {
            toolPart.toolInvocation.result = result;
            toolPart.toolInvocation.state = (result as any)?.isError
              ? "error"
              : "result";
            updateParts();
          }
        };

        let buffer = "";
        while (true) {
          if (runtime.abortController?.signal.aborted) {
            await reader.cancel();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              if (streamProtocol === "data-stream") {
                // Vercel AI SDK wire format: <code>:<json-value>
                const colonIdx = line.indexOf(":");
                if (colonIdx === -1) continue;
                const code = line.slice(0, colonIdx);
                const jsonPart = line.slice(colonIdx + 1);
                let val: unknown;
                try {
                  val = JSON.parse(jsonPart);
                } catch {
                  continue;
                }

                switch (code) {
                  case "0": {
                    const delta = typeof val === "string" ? val : String(val);
                    recordTrace({ type: "text-delta", delta, raw: val });
                    appendText(delta);
                    break;
                  }
                  case "b": {
                    const tc = val as Record<string, unknown>;
                    const toolCallId = String(
                      tc.toolCallId ?? `tool-${parts.length}`
                    );
                    const toolName = String(tc.toolName ?? "");
                    recordTrace({
                      type: "tool-call-start",
                      toolCallId,
                      toolName,
                      raw: val,
                    });
                    appendToolCallStart(toolCallId, toolName);
                    break;
                  }
                  case "c": {
                    const tc = val as Record<string, unknown>;
                    const toolCallId = String(tc.toolCallId ?? "");
                    const argsDelta = String(
                      tc.argsTextDelta ?? tc.argsDelta ?? ""
                    );
                    appendToolCallDelta(toolCallId, argsDelta);
                    break;
                  }
                  case "9": {
                    const tc = val as Record<string, unknown>;
                    // Unwrap LangChain-style { input: "<json>" } args
                    let args = (tc.args ?? {}) as Record<string, unknown>;
                    if (
                      typeof args.input === "string" &&
                      Object.keys(args).length === 1
                    ) {
                      try {
                        const parsed = JSON.parse(args.input);
                        if (typeof parsed === "object" && parsed !== null)
                          args = parsed;
                      } catch {
                        /* keep original */
                      }
                    }
                    const toolCallId = String(
                      tc.toolCallId ?? `tool-${parts.length}`
                    );
                    const toolName = String(tc.toolName ?? "");
                    if (!toolCallIdToIndex.has(toolCallId)) {
                      recordTrace({
                        type: "tool-call-start",
                        toolCallId,
                        toolName,
                        raw: val,
                      });
                    }
                    recordTrace({
                      type: "tool-call-args",
                      toolCallId,
                      toolName,
                      args,
                      raw: val,
                    });
                    appendToolCall(toolCallId, toolName, args);
                    break;
                  }
                  case "a": {
                    const tr = val as Record<string, unknown>;
                    const idx = toolCallIdToIndex.get(tr.toolCallId as string);
                    // Unwrap LangChain ToolMessage wrapper
                    let result = tr.result;
                    const lc = result as Record<string, unknown> | undefined;
                    if (
                      lc?.lc === 1 &&
                      lc?.type === "constructor" &&
                      (lc?.kwargs as any)?.content
                    ) {
                      const raw = (lc.kwargs as Record<string, unknown>)
                        .content as string;
                      if (typeof raw === "string") {
                        try {
                          result = JSON.parse(raw);
                        } catch {
                          result = raw;
                        }
                      }
                    }
                    if (idx !== undefined) {
                      recordTrace({
                        type: "tool-result",
                        toolCallId: String(tr.toolCallId ?? ""),
                        toolName:
                          parts[idx]?.toolInvocation?.toolName ?? "Tool",
                        result,
                        isError: Boolean(
                          result &&
                          typeof result === "object" &&
                          (result as Record<string, unknown>).isError
                        ),
                        raw: val,
                      });
                      resolveToolResult({ by: "index", index: idx }, result);
                    }
                    break;
                  }
                  case "d": {
                    const envelope =
                      val && typeof val === "object"
                        ? (val as Record<string, unknown>)
                        : undefined;
                    const usage = inspectorTokenUsageFromUnknown(
                      envelope?.usage
                    );
                    if (usage) {
                      recordTrace({ type: "usage", usage, raw: val });
                    }
                    recordTrace({ type: "done", raw: val });
                    finalizeParts();
                    break;
                  }
                  case "3": {
                    recordTrace({
                      type: "error",
                      message:
                        typeof val === "string" ? val : JSON.stringify(val),
                      raw: val,
                    });
                    throw new Error(
                      typeof val === "string" ? val : JSON.stringify(val)
                    );
                  }
                  default:
                    break;
                }
              } else {
                // SSE format: lines start with "data: "
                if (!line.startsWith("data: ")) continue;
                const event = JSON.parse(line.slice(6));

                if (event.type === "message") {
                  // Stream start — no UI update needed
                } else if (event.type === "text") {
                  recordTrace({
                    type: "text-delta",
                    delta: event.content,
                    raw: event,
                  });
                  appendText(event.content);
                } else if (event.type === "tool-call-start") {
                  const toolCallId = event.toolCallId ?? `tool-${parts.length}`;
                  recordTrace({
                    type: "tool-call-start",
                    toolCallId,
                    toolName: event.toolName,
                    raw: event,
                  });
                  appendToolCallStart(toolCallId, event.toolName);
                } else if (
                  event.type === "tool-call-delta" ||
                  event.type === "tool-call-args-delta"
                ) {
                  appendToolCallDelta(
                    event.toolCallId,
                    event.argsDelta ?? event.argsTextDelta ?? ""
                  );
                } else if (event.type === "tool-call") {
                  const toolCallId = event.toolCallId ?? `tool-${parts.length}`;
                  if (!toolCallIdToIndex.has(toolCallId)) {
                    recordTrace({
                      type: "tool-call-start",
                      toolCallId,
                      toolName: event.toolName,
                      raw: event,
                    });
                  }
                  recordTrace({
                    type: "tool-call-args",
                    toolCallId,
                    toolName: event.toolName,
                    args: event.args,
                    raw: event,
                  });
                  appendToolCall(toolCallId, event.toolName, event.args);
                } else if (event.type === "tool-result") {
                  recordTrace({
                    type: "tool-result",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    result: event.result,
                    isError: event.isError ?? event.result?.isError,
                    raw: event,
                  });
                  const resultIndex = toolCallIdToIndex.get(event.toolCallId);
                  resolveToolResult(
                    resultIndex === undefined
                      ? { by: "toolName", toolName: event.toolName }
                      : { by: "index", index: resultIndex },
                    event.result
                  );
                } else if (event.type === "done") {
                  const usage = inspectorTokenUsageFromUnknown(event.usage);
                  if (usage) {
                    recordTrace({ type: "usage", usage, raw: event });
                  }
                  recordTrace({ type: "done", raw: event });
                  finalizeParts();
                } else if (event.type === "usage") {
                  const usage = inspectorTokenUsageFromUnknown(
                    event.usage ?? event
                  );
                  if (usage) {
                    recordTrace({ type: "usage", usage, raw: event });
                  }
                } else if (event.type === "error") {
                  recordTrace({
                    type: "error",
                    message: event.message || "Streaming error",
                    raw: event,
                  });
                  throw new Error(event.message || "Streaming error");
                }
              }
            } catch (parseError) {
              if (
                parseError instanceof Error &&
                parseError.message !== "Streaming error"
              ) {
                console.error(
                  "Failed to parse streaming event:",
                  parseError,
                  line
                );
              } else {
                throw parseError;
              }
            }
          }
        }

        // If aborted, mark any pending tool calls as cancelled
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

          // Update messages with cancelled tool calls
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
        }
      } catch (error) {
        // Don't show Abort Error
        if (error instanceof DOMException && error.name === "AbortError") {
          if (options?.throwOnError) {
            throw new Error("Chat turn was cancelled");
          }
          return;
        }

        if (chatApiUrl && isCloudFetchFailure(error)) {
          setManagedChatNotice({ kind: "cloud_unavailable" });
          if (options?.throwOnError) {
            throw new Error("Chat service is unavailable");
          }
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
        if (options?.throwOnError) {
          throw new Error(errorDetail);
        }
      } finally {
        setIsLoading(false);
        runtime.abortController = null;
        runtime.sendInProgress = false;
      }
    },
    [
      llmConfig,
      isConnected,
      mcpServerUrl,
      messages,
      authConfig,
      mcpAuthTokens,
      attachments,
      chatApiUrl,
      waitForChatApiUrl,
      widgetModelContexts,
      disabledTools,
      streamProtocol,
      credentials,
      extraHeaders,
      bodyBuilder,
      recordTrace,
      runtime,
      setAttachments,
      setIsLoading,
      setManagedChatNotice,
      setMcpServerAuthRequired,
      setMessages,
    ]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setManagedChatNotice(null);
    setMcpServerAuthRequired(null);
    setTraceState(EMPTY_TRACE_STATE);
  }, [
    setManagedChatNotice,
    setMcpServerAuthRequired,
    setMessages,
    setTraceState,
  ]);

  const clearManagedChatNotice = useCallback(() => {
    setManagedChatNotice(null);
  }, [setManagedChatNotice]);

  const showManagedChatNotice = useCallback(
    (notice: ManagedChatNotice) => {
      setManagedChatNotice(notice);
    },
    [setManagedChatNotice]
  );

  const clearTrace = useCallback(
    () => setTraceState(EMPTY_TRACE_STATE),
    [setTraceState]
  );

  const clearMcpServerAuthRequired = useCallback(() => {
    setMcpServerAuthRequired(null);
  }, [setMcpServerAuthRequired]);

  const stop = useCallback(() => {
    runtime.abortController?.abort();
  }, [runtime]);

  const addAttachment = useCallback(
    async (file: File) => {
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
    },
    [setAttachments]
  );

  const removeAttachment = useCallback(
    (index: number) => {
      setAttachments((prev) => prev.filter((_, i) => i !== index));
    },
    [setAttachments]
  );

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, [setAttachments]);

  return {
    sessionId: activeSessionId,
    messages,
    isLoading,
    attachments,
    managedChatNotice,
    mcpServerAuthRequired,
    sendMessage,
    clearMessages,
    clearManagedChatNotice,
    showManagedChatNotice,
    clearMcpServerAuthRequired,
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
