import { MarkdownRenderer } from "@/client/components/shared/MarkdownRenderer";
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
  _isStreaming: _,
}: AssistantMessageProps) {
  if (!content || content.length === 0) {
    return null;
  }

  return (
    <div
      className="flex items-start gap-6 group/message relative"
      data-testid="chat-message-assistant"
    >
      <div className="flex-1 min-w-0">
        <div className="wrap-break-word">
          <div
            className="text-base leading-7 font-sans text-start wrap-break-word transition-all duration-300 ease-in-out"
            data-testid="chat-message-content"
          >
            <MarkdownRenderer content={content} />
          </div>
        </div>

        {timestamp && (
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-muted-foreground">
              {new Date(timestamp).toLocaleTimeString()}
            </span>

            <CopyButton text={content} />
          </div>
        )}
      </div>
    </div>
  );
}
