import { TextShimmer } from "@/client/components/ui/text-shimmer";
import { Button } from "@/client/components/ui/button";
import { Loader2, LockKeyhole, RotateCw } from "lucide-react";
import { memo, useCallback, useMemo, useRef, type RefObject } from "react";
import type { MessageContentBlock } from "@/client/types/message-content-block";
import { AssistantMessage } from "./AssistantMessage";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ToolResultRenderer } from "./ToolResultRenderer";
import { UserMessage } from "./UserMessage";
import type {
  LLMConfig,
  MessageAttachment,
  ToolAuthenticationRequest,
} from "./types";
import { isViewTool, type McpServer } from "@mcp-use/client/react";
import { buildMessageTokenMap, type InspectorTraceEvent } from "./trace";
import { normalizeWidgetMessage } from "./widget-message";
import { isAuthenticationRequiredToolResult } from "./mixed-auth-tool-result";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string | Array<{ index: number; type: string; text: string }>;
  timestamp: number;
  attachments?: MessageAttachment[];
  parts?: Array<{
    type: "text" | "tool-invocation";
    text?: string;
    toolInvocation?: {
      toolCallId?: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: any;
      state?: "pending" | "streaming" | "result" | "error";
      partialArgs?: Record<string, unknown>;
    };
  }>;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result?: any;
  }>;
}

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  serverId?: string;
  readResource?: (uri: string) => Promise<any>;
  tools?: any[];
  sendMessage?: (
    message: string,
    attachments?: MessageAttachment[]
  ) => Promise<void>;
  /** When provided, passed to widget renderers to avoid useMcpClient() context lookup. */
  serverBaseUrl?: string;
  /** Anchor at the end of the thread — owned by useChatScrollToBottom in ChatTab. */
  messagesEndRef?: RefObject<HTMLDivElement | null>;
  /** Trace events used to derive per-message token counts on hover. */
  traceEvents?: InspectorTraceEvent[];
  modelContextScope?: string;
  llmConfig?: LLMConfig | null;
  /** Keep tool-call chrome but omit MCP App result bodies (e.g. chat drawer). */
  renderToolResults?: boolean;
  authorization?: McpServer["authorization"];
  onAuthenticateTool?: (request: ToolAuthenticationRequest) => Promise<void>;
  onRetryTool?: (request: ToolAuthenticationRequest) => Promise<void>;
  authenticatingTool?: boolean;
  retryingTool?: boolean;
}

interface ToolAuthenticationPromptProps {
  toolName: string;
  authenticated: boolean;
  busy: boolean;
  onAction?: () => Promise<void>;
}

function ToolAuthenticationPrompt({
  toolName,
  authenticated,
  busy,
  onAction,
}: ToolAuthenticationPromptProps) {
  return (
    <div
      className="-mt-2 mb-4 flex max-w-xl items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
      data-testid={`chat-tool-auth-required-${toolName}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-medium">Authentication required</p>
          <p className="text-xs text-muted-foreground">
            {authenticated
              ? `Retry ${toolName} with your authenticated connection.`
              : `${toolName} is waiting for you to authenticate.`}
          </p>
        </div>
      </div>
      {onAction ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 bg-background"
          disabled={busy}
          onClick={() => void onAction()}
          data-testid={`chat-tool-auth-action-${toolName}`}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : authenticated ? (
            <RotateCw className="size-3.5" />
          ) : (
            <LockKeyhole className="size-3.5" />
          )}
          {authenticated ? "Retry tool" : "Authenticate to use this tool"}
        </Button>
      ) : null}
    </div>
  );
}

export const MessageList = memo(
  ({
    messages,
    isLoading,
    serverId,
    readResource,
    tools,
    sendMessage,
    messagesEndRef,
    traceEvents = [],
    modelContextScope,
    llmConfig,
    renderToolResults = true,
    authorization,
    onAuthenticateTool,
    onRetryTool,
    authenticatingTool = false,
    retryingTool = false,
  }: MessageListProps) => {
    const widgetMessageInFlightRef = useRef(false);
    const isLoadingRef = useRef(isLoading);
    isLoadingRef.current = isLoading;
    const sendMessageRef = useRef(sendMessage);
    sendMessageRef.current = sendMessage;
    const messageTokenMap = useMemo(
      () => buildMessageTokenMap(messages, traceEvents),
      [messages, traceEvents]
    );

    // Helper function to get tool metadata by name.
    // Normalizes hyphens/underscores because the Anthropic API converts
    // hyphenated tool names to underscores in tool_use responses while
    // MCP servers register tools with the original (often hyphenated) names.
    const getToolMeta = (toolName: string): Record<string, any> | undefined => {
      const normalize = (n: string) => n.replace(/-/g, "_");
      const key = normalize(toolName);
      const tool = tools?.find((t) => normalize(t.name) === key);
      return tool?._meta;
    };

    // Helper function to check if a tool has widget support
    const isWidgetTool = (toolName: string): boolean => {
      const toolMeta = getToolMeta(toolName);
      return isViewTool(toolMeta);
    };

    const handleFollowUp = useCallback(
      async (content: MessageContentBlock[]) => {
        if (isLoadingRef.current || widgetMessageInFlightRef.current) {
          throw new Error("Chat is busy with another turn");
        }
        const currentSendMessage = sendMessageRef.current;
        if (!currentSendMessage) {
          throw new Error("Chat is not available on this host surface");
        }

        const normalized = normalizeWidgetMessage(content);
        widgetMessageInFlightRef.current = true;
        try {
          await currentSendMessage(
            normalized.text,
            normalized.attachments.length > 0
              ? normalized.attachments
              : undefined
          );
        } finally {
          widgetMessageInFlightRef.current = false;
        }
      },
      []
    );

    // Determine if we're in "thinking" state vs "streaming" state
    const isThinking =
      isLoading &&
      (() => {
        if (messages.length === 0) return true;

        const lastMessage = messages[messages.length - 1];
        // If last message is from user, we're thinking
        if (lastMessage.role === "user") return true;

        // If last message is from assistant but empty/minimal content, we're thinking
        if (lastMessage.role === "assistant") {
          // Check parts array first — streaming delivers content via parts
          // while content may remain "" until after the stream reader closes
          if (lastMessage.parts && lastMessage.parts.length > 0) {
            return false;
          }

          const contentStr =
            typeof lastMessage.content === "string"
              ? lastMessage.content
              : Array.isArray(lastMessage.content)
                ? lastMessage.content
                    .map((item) =>
                      typeof item === "string"
                        ? item
                        : item.text || JSON.stringify(item)
                    )
                    .join("")
                : JSON.stringify(lastMessage.content);

          const hasContent = contentStr && contentStr.trim().length > 0;
          return !hasContent;
        }

        return false;
      })();

    // Determine if a message is currently streaming
    const lastMessage = messages[messages.length - 1];
    const isLastAssistantStreaming =
      isLoading && lastMessage?.role === "assistant";

    const getLastTextPartIndex = (parts: NonNullable<Message["parts"]>) => {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i]?.type === "text") return i;
      }
      return -1;
    };

    const isTextPartStreaming = (
      message: Message,
      partIndex: number,
      parts: NonNullable<Message["parts"]>
    ) =>
      isLastAssistantStreaming &&
      message.id === lastMessage?.id &&
      partIndex === getLastTextPartIndex(parts);

    const isMessageStreaming = (message: Message) =>
      isLastAssistantStreaming && message.id === lastMessage?.id;

    return (
      <div className="space-y-6 max-w-3xl mx-auto px-2">
        {messages.map((message) => {
          const contentStr =
            typeof message.content === "string"
              ? message.content
              : Array.isArray(message.content)
                ? message.content
                    .map((item) =>
                      typeof item === "string"
                        ? item
                        : item.text || JSON.stringify(item)
                    )
                    .join("")
                : JSON.stringify(message.content);

          if (message.role === "user") {
            return (
              <UserMessage
                key={message.id}
                content={contentStr}
                timestamp={message.timestamp}
                attachments={message.attachments}
                inputTokens={messageTokenMap.get(message.id)?.inputTokens}
              />
            );
          }

          if (message.role === "assistant") {
            const outputTokens = messageTokenMap.get(message.id)?.outputTokens;
            const lastTextPartIndex =
              message.parts && message.parts.length > 0
                ? getLastTextPartIndex(message.parts)
                : -1;
            const firstAuthRequiredPartIndex =
              authorization?.mode === "mixed" && message.parts
                ? message.parts.findIndex(
                    (part) =>
                      part.type === "tool-invocation" &&
                      part.toolInvocation?.state === "error" &&
                      isAuthenticationRequiredToolResult(
                        part.toolInvocation.result,
                        true
                      )
                  )
                : -1;

            return (
              <div key={message.id} className="space-y-4">
                {/* Handle message parts if available (for proper ordering) */}
                {message.parts && message.parts.length > 0 ? (
                  message.parts.map((part, partIndex) => {
                    const partKey =
                      part.type === "text"
                        ? `${message.id}-text-${partIndex}`
                        : `${message.id}-tool-${part.toolInvocation?.toolCallId ?? `${part.toolInvocation?.toolName}-${partIndex}`}`;

                    if (part.type === "text") {
                      if (
                        firstAuthRequiredPartIndex >= 0 &&
                        partIndex > firstAuthRequiredPartIndex
                      ) {
                        return null;
                      }
                      return (
                        <AssistantMessage
                          key={partKey}
                          content={part.text || ""}
                          timestamp={
                            partIndex === message.parts!.length - 1
                              ? message.timestamp
                              : undefined
                          }
                          _isStreaming={isTextPartStreaming(
                            message,
                            partIndex,
                            message.parts!
                          )}
                          outputTokens={
                            partIndex === lastTextPartIndex
                              ? outputTokens
                              : undefined
                          }
                        />
                      );
                    } else if (
                      part.type === "tool-invocation" &&
                      part.toolInvocation
                    ) {
                      const requiresAuthentication =
                        authorization?.mode === "mixed" &&
                        part.toolInvocation.state === "error" &&
                        isAuthenticationRequiredToolResult(
                          part.toolInvocation.result,
                          true
                        );
                      const authenticationRequest: ToolAuthenticationRequest = {
                        messageId: message.id,
                        toolCallId: part.toolInvocation.toolCallId,
                        toolName: part.toolInvocation.toolName,
                        args: part.toolInvocation.args,
                      };
                      const authenticated =
                        authorization?.authenticated === true;
                      return (
                        <div key={partKey}>
                          <ToolCallDisplay
                            toolName={part.toolInvocation.toolName}
                            args={part.toolInvocation.args}
                            result={
                              requiresAuthentication
                                ? undefined
                                : part.toolInvocation.result
                            }
                            state={
                              requiresAuthentication
                                ? "auth"
                                : part.toolInvocation.state === "error"
                                  ? "error"
                                  : part.toolInvocation.state === "streaming"
                                    ? "call"
                                    : part.toolInvocation.state === "pending"
                                      ? "call"
                                      : "result"
                            }
                            partialArgs={part.toolInvocation.partialArgs}
                          />
                          {requiresAuthentication ? (
                            <ToolAuthenticationPrompt
                              toolName={part.toolInvocation.toolName}
                              authenticated={authenticated}
                              busy={
                                authenticated
                                  ? retryingTool
                                  : authenticatingTool
                              }
                              onAction={
                                authenticated
                                  ? onRetryTool
                                    ? () => onRetryTool(authenticationRequest)
                                    : undefined
                                  : onAuthenticateTool
                                    ? () =>
                                        onAuthenticateTool(
                                          authenticationRequest
                                        )
                                    : undefined
                              }
                            />
                          ) : null}
                          {/* Render tool result / widget */}
                          {/* Render immediately for widget tools or streaming tools, even if result is null */}
                          {renderToolResults &&
                            !requiresAuthentication &&
                            (part.toolInvocation.result ||
                              part.toolInvocation.state === "streaming" ||
                              isWidgetTool(part.toolInvocation.toolName)) && (
                              <div
                                data-tool-call-id={`${message.id}-${part.toolInvocation.toolName}-${partIndex}`}
                              >
                                <ToolResultRenderer
                                  toolName={part.toolInvocation.toolName}
                                  toolArgs={part.toolInvocation.args}
                                  result={part.toolInvocation.result || null}
                                  serverId={serverId}
                                  readResource={readResource}
                                  toolMeta={getToolMeta(
                                    part.toolInvocation.toolName
                                  )}
                                  onSendFollowUp={handleFollowUp}
                                  modelContextScope={modelContextScope}
                                  llmConfig={llmConfig}
                                  partialToolArgs={
                                    part.toolInvocation.partialArgs
                                  }
                                  cancelled={
                                    part.toolInvocation.state === "error" &&
                                    part.toolInvocation.result ===
                                      "Cancelled by user"
                                  }
                                />
                              </div>
                            )}
                        </div>
                      );
                    }
                    return null;
                  })
                ) : (
                  <>
                    <AssistantMessage
                      content={contentStr}
                      timestamp={message.timestamp}
                      _isStreaming={isMessageStreaming(message)}
                      outputTokens={outputTokens}
                    />

                    {/* Tool Calls (fallback for non-parts messages) */}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="space-y-2">
                        {message.toolCalls.map((toolCall) => {
                          const toolCallKey = `${message.id}-${toolCall.toolName}-${JSON.stringify(toolCall.args).slice(0, 50)}`;

                          return (
                            <div key={toolCallKey}>
                              <ToolCallDisplay
                                toolName={toolCall.toolName}
                                args={toolCall.args}
                                result={toolCall.result}
                                state={toolCall.result ? "result" : "call"}
                              />
                              {/* Render tool result / widget */}
                              {/* Render immediately for widget tools or streaming tools, even if result is null */}
                              {renderToolResults &&
                                (toolCall.result ||
                                  isWidgetTool(toolCall.toolName)) && (
                                  <div data-tool-call-id={toolCallKey}>
                                    <ToolResultRenderer
                                      toolName={toolCall.toolName}
                                      toolArgs={toolCall.args}
                                      result={toolCall.result || null}
                                      serverId={serverId}
                                      readResource={readResource}
                                      toolMeta={getToolMeta(toolCall.toolName)}
                                      onSendFollowUp={handleFollowUp}
                                      modelContextScope={modelContextScope}
                                      llmConfig={llmConfig}
                                    />
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          }

          return null;
        })}

        {/* Thinking indicator - only show when actually thinking, not streaming */}
        {isThinking && (
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="rounded-lg p-4 max-w-fit">
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    <TextShimmer duration={2} spread={1}>
                      Thinking...
                    </TextShimmer>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    );
  }
);
