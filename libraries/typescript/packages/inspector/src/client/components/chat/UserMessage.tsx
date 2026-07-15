import { useMemo } from "react";
import { ChatMessage } from "@/client/components/ui/chat-message";
import { CopyButton } from "./CopyButton";
import type { MessageAttachment } from "./types";

interface UserMessageProps {
  content: string;
  timestamp?: Date | number;
  attachments?: MessageAttachment[];
}

function attachmentToFile(attachment: MessageAttachment): File {
  const binary = atob(attachment.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], attachment.name || "attachment", {
    type: attachment.mimeType,
  });
}

export function UserMessage({
  content,
  timestamp,
  attachments,
}: UserMessageProps) {
  const files = useMemo(
    () => attachments?.map(attachmentToFile),
    [attachments]
  );

  if (
    (!content || content.length === 0) &&
    (!attachments || attachments.length === 0)
  ) {
    return null;
  }

  return (
    <div data-testid="chat-message-user">
      <ChatMessage
        from="user"
        files={files}
        time={
          timestamp
            ? new Date(timestamp).toLocaleTimeString()
            : undefined
        }
        actions={content ? <CopyButton text={content} /> : undefined}
        data-testid="chat-message-content"
      >
        {content && content.length > 0 ? content : undefined}
      </ChatMessage>
    </div>
  );
}
