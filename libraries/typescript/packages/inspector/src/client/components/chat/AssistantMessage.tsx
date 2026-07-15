import { StreamingAssistantContent } from "./StreamingAssistantContent";
import { ChatMessage } from "@/client/components/ui/chat-message";
import { MessageMetaActions } from "./MessageMetaActions";

interface AssistantMessageProps {
  content: string;
  timestamp?: Date | number;
  /** Internal: indicates the message is currently being streamed */
  _isStreaming?: boolean;
  outputTokens?: number;
}

export function AssistantMessage({
  content,
  timestamp,
  _isStreaming: isStreaming,
  outputTokens,
}: AssistantMessageProps) {
  if (!content || content.length === 0) {
    return null;
  }

  return (
    <div data-testid="chat-message-assistant">
      <ChatMessage
        from="assistant"
        actions={
          <MessageMetaActions
            variant="assistant"
            copyText={content}
            outputTokens={outputTokens}
          />
        }
        data-testid="chat-message-content"
      >
        <StreamingAssistantContent
          content={content}
          isStreaming={isStreaming}
        />
      </ChatMessage>
      {timestamp != null && (
        <span className="sr-only">
          {new Date(timestamp).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
