import type { MessageAttachment } from "./types";

interface UserMessageProps {
  content: string;
  timestamp?: Date | number;
  attachments?: MessageAttachment[];
}

export function UserMessage({
  content,
  timestamp,
  attachments,
}: UserMessageProps) {
  // Don't render if no content and no attachments
  if (
    (!content || content.length === 0) &&
    (!attachments || attachments.length === 0)
  ) {
    return null;
  }

  return (
    <div
      className="flex items-start gap-3 justify-end group/user-message"
      data-testid="chat-message-user"
    >
      <div className="flex-1 min-w-0 flex flex-col items-end">
        <div
          className="bg-zinc-200 dark:bg-zinc-800 text-primary rounded-3xl px-4 py-2 max-w-[80%] break-words"
          data-testid="chat-message-content"
        >
          {/* Render image attachments */}
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((attachment, index) => (
                <div
                  key={index}
                  className="rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700"
                >
                  <img
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                    alt={attachment.name || `Attachment ${index + 1}`}
                    className="max-w-[200px] max-h-[200px] object-contain"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Only show text if there is content */}
          {content && content.length > 0 && (
            <p className="text-base leading-7 font-sans text-start break-words">
              {content}
            </p>
          )}
        </div>

        {timestamp && (
          <span className="text-xs text-muted-foreground mt-1">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
