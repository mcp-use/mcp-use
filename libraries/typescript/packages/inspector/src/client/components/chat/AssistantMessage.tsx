import { StreamingAssistantContent } from "./StreamingAssistantContent";
import { ChatMessage } from "@/client/components/ui/chat-message";
import { CopyButton } from "./CopyButton";

interface AssistantMessageProps {
  content: string;
  timestamp?: Date | number;
  /** Internal: indicates the message is currently being streamed */
  _isStreaming?: boolean;
}

export function AssistantMessage({
  content,
  timestamp,
  _isStreaming: isStreaming,
}: AssistantMessageProps) {
  if (!content || content.length === 0) {
    return null;
  }

  return (
    <div data-testid="chat-message-assistant">
      <ChatMessage
        from="assistant"
        actions={<CopyButton text={content} />}
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
