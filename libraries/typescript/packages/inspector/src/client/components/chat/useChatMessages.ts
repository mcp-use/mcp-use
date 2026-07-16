import { useCallback, useRef, useState } from "react";
import { inspectorApi } from "@/client/utils/basePath";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import {
  convertMessagesToProvider,
  convertPromptResultsToMessages,
} from "./conversion";
import type {
  AuthConfig,
  LLMConfig,
  Message,
  MessageAttachment,
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

interface WidgetModelContext {
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

interface UseChatMessagesProps {
  mcpServerUrl: string;
  llmConfig: LLMConfig | null;
  authConfig: AuthConfig | null;
  isConnected: boolean;
  /** Custom API endpoint URL for chat streaming. Defaults to "/inspector/api/chat/stream". */
  chatApiUrl?: string;
  /** When chatApiUrl is not yet available, called before sending to resolve the URL. Useful for background initialization. */
  waitForChatApiUrl?: () => Promise<string | undefined>;
  /** Active widget model contexts to inject into the LLM conversation */
  widgetModelContexts?: Map<string, WidgetModelContext | undefined>;
  /** Pre-populate the chat with messages from a previous session (e.g. when restoring history). */
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
   * Use this to send only `{ messages }` to a server-managed backend.
   */
  body?: (
    messages: Array<{ role: string; content: unknown; attachments?: unknown }>
  ) => unknown;
}

export function useChatMessages({
  mcpServerUrl,
  llmConfig,
  authConfig,
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
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [traceState, setTraceState] = useState(EMPTY_TRACE_STATE);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    loginUrl: string;
  } | null>(null);
  const [mcpServerAuthRequired, setMcpServerAuthRequired] = useState<{
    mcpServerUrl: string;
    message?: string;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const traceIdRef = useRef(0);

  const recordTrace = useCallback((event: InspectorTraceEventInput) => {
    const next = {
      ...event,
      id: `trace-${++traceIdRef.current}`,
      timestamp: Date.now(),
    } as InspectorTraceEvent;
    setTraceState((state) => appendTraceEvent(state, next));
  }, []);

  const sendMessage = useCallback(
    async (
      userInput: string,
      promptResults: PromptResult[],
      extraAttachments?: MessageAttachment[]
    ) => {
      const allAttachments = [...attachments, ...(extraAttachments ?? [])];
      // Can send if there's text, prompt results, or attachments
      const hasContent =
        userInput.trim() ||
        promptResults.length > 0 ||
        allAttachments.length > 0;
      if (!hasContent || !llmConfig || !isConnected) {
        return;
      }

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

        // Build widget state context messages (per SEP-1865 ui/update-model-context)
        // These inform the LLM about current widget UI state so it can reason about what the user sees.
        const widgetContextMessages: Message[] = [];
        if (widgetModelContexts && widgetModelContexts.size > 0) {
          const parts: string[] = [];
          for (const [, ctx] of widgetModelContexts) {
            if (!ctx) continue;
            if (ctx.content?.length) {
              parts.push(ctx.content.map((c) => c.text).join("\n"));
            } else if (ctx.structuredContent) {
              parts.push(JSON.stringify(ctx.structuredContent));
            }
          }
          if (parts.length > 0) {
            widgetContextMessages.push({
              id: `widget-context-${Date.now()}`,
              role: "user",
              content: `[Current Widget State]\n${parts.join("\n")}`,
              timestamp: Date.now(),
            });
          }
        }

        const historyMessages = [
          ...messages,
          ...userMessages,
          ...widgetContextMessages,
        ];

        const serialisedMessages = [
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

        const requestBody = bodyBuilder
          ? bodyBuilder(serialisedMessages)
          : {
              mcpServerUrl,
              llmConfig,
              authConfig: authConfigWithTokens,
              messages: serialisedMessages,
              ...(disabledTools && disabledTools.size > 0
                ? { disabledTools: [...disabledTools] }
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
              ...(disabledTools && disabledTools.size > 0
                ? { disabledTools: [...disabledTools] }
                : {}),
            };
        recordTrace({
          type: "request",
          request: {
            url: resolvedUrl,
            protocol: streamProtocol,
            envelope: requestEnvelope,
            providerMessages: convertMessagesToProvider(historyMessages),
          },
        });

        const response = await fetch(resolvedUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...extraHeaders,
          },
          signal: abortControllerRef.current.signal,
          ...(credentials ? { credentials } : {}),
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          if (response.status === 429) {
            const errBody = await response.json().catch(() => null);
            if (errBody?.loginRequired && errBody?.loginUrl) {
              setRateLimitInfo({ loginUrl: errBody.loginUrl as string });
            }
            // Remove the empty assistant message added optimistically
            setMessages((prev) =>
              prev.filter((m) => m.id !== `assistant-${Date.now()}`)
            );
            return;
          }
          if (response.status === 401) {
            const errBody = await response.json().catch(() => null);
            if (errBody?.error === "mcp_auth_required") {
              setMcpServerAuthRequired({
                mcpServerUrl:
                  (errBody.mcpServerUrl as string | undefined) ?? mcpServerUrl,
                message: errBody.message as string | undefined,
              });
              return;
            }
          }
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
            state?: "pending" | "result" | "error";
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
        const appendToolCall = (
          toolName: string,
          args: Record<string, unknown>
        ) => {
          if (currentTextPart) currentTextPart = "";
          parts.push({
            type: "tool-invocation",
            toolInvocation: { toolName, args, state: "pending" },
          });
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

        // data-stream protocol state: maps toolCallId → parts array index
        const toolCallIdToIndex = new Map<string, number>();

        let buffer = "";
        while (true) {
          if (abortControllerRef.current?.signal.aborted) {
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
                    recordTrace({
                      type: "tool-call-start",
                      toolCallId,
                      toolName,
                      raw: val,
                    });
                    recordTrace({
                      type: "tool-call-args",
                      toolCallId,
                      toolName,
                      args,
                      raw: val,
                    });
                    appendToolCall(toolName, args);
                    if (tc.toolCallId) {
                      toolCallIdToIndex.set(
                        tc.toolCallId as string,
                        parts.length - 1
                      );
                    }
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
                } else if (event.type === "tool-call") {
                  const toolCallId = event.toolCallId ?? `tool-${parts.length}`;
                  recordTrace({
                    type: "tool-call-start",
                    toolCallId,
                    toolName: event.toolName,
                    raw: event,
                  });
                  recordTrace({
                    type: "tool-call-args",
                    toolCallId,
                    toolName: event.toolName,
                    args: event.args,
                    raw: event,
                  });
                  appendToolCall(event.toolName, event.args);
                } else if (event.type === "tool-result") {
                  recordTrace({
                    type: "tool-result",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    result: event.result,
                    isError: event.isError ?? event.result?.isError,
                    raw: event,
                  });
                  resolveToolResult(
                    { by: "toolName", toolName: event.toolName },
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
    [
      llmConfig,
      isConnected,
      mcpServerUrl,
      messages,
      authConfig,
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
    ]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setRateLimitInfo(null);
    setMcpServerAuthRequired(null);
    setTraceState(EMPTY_TRACE_STATE);
  }, []);

  const clearRateLimitInfo = useCallback(() => {
    setRateLimitInfo(null);
  }, []);
  const clearTrace = useCallback(() => setTraceState(EMPTY_TRACE_STATE), []);

  const clearMcpServerAuthRequired = useCallback(() => {
    setMcpServerAuthRequired(null);
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
    rateLimitInfo,
    mcpServerAuthRequired,
    sendMessage,
    clearMessages,
    clearRateLimitInfo,
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
