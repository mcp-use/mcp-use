import { TextShimmer } from "@/client/components/ui/text-shimmer";
import { memo, useCallback, useMemo, useRef, type RefObject } from "react";
import type { MessageContentBlock } from "@/client/types/message-content-block";
import { AssistantMessage } from "./AssistantMessage";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ToolResultRenderer } from "./ToolResultRenderer";
import { UserMessage } from "./UserMessage";
import type { LLMConfig, MessageAttachment } from "./types";
import { isViewTool } from "@mcp-use/client/react";
import { buildMessageTokenMap, type InspectorTraceEvent } from "./trace";
import { normalizeWidgetMessage } from "./widget-message";

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
      state?:
        | "pending"
        | "streaming"
        | "authorization-required"
        | "result"
        | "error";
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
  onAuthenticateTool?: (toolCallId: string) => Promise<void> | void;
  authenticatingToolCallId?: string | null;
  toolAuthorizationError?: string | null;
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
    onAuthenticateTool,
    authenticatingToolCallId,
    toolAuthorizationError,
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
                      return (
                        <div key={partKey}>
                          <ToolCallDisplay
                            toolName={part.toolInvocation.toolName}
                            toolCallId={part.toolInvocation.toolCallId}
                            args={part.toolInvocation.args}
                            result={part.toolInvocation.result}
                            state={
                              part.toolInvocation.state ===
                              "authorization-required"
                                ? "authorization-required"
                                : part.toolInvocation.state === "error"
                                  ? "error"
                                  : part.toolInvocation.state === "streaming"
                                    ? "call"
                                    : part.toolInvocation.state === "pending"
                                      ? "call"
                                      : "result"
                            }
                            partialArgs={part.toolInvocation.partialArgs}
                            onAuthenticate={onAuthenticateTool}
                            isAuthenticating={
                              authenticatingToolCallId ===
                              part.toolInvocation.toolCallId
                            }
                            authorizationError={
                              part.toolInvocation.state ===
                              "authorization-required"
                                ? toolAuthorizationError
                                : null
                            }
                          />
                          {/* Render tool result / widget */}
                          {/* Render immediately for widget tools or streaming tools, even if result is null */}
                          {renderToolResults &&
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
