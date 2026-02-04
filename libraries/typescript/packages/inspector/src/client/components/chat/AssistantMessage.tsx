import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { MarkdownRenderer } from "@/client/components/shared/MarkdownRenderer";

/**
 * Button that copies the provided text to the clipboard and shows a brief visual confirmation.
 *
 * @param text - The string content to copy when the button is clicked.
 * @returns A button element that copies `text` to the clipboard and displays a check icon for two seconds after a successful copy.
 */
function CopyButton({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <button
      className="opacity-0 group-hover/message:opacity-100 transition-opacity text-muted-foreground hover:text-foreground text-xs flex items-center gap-1"
      onClick={handleCopy}
      title="Copy message content"
    >
      {isCopied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

interface AssistantMessageProps {
  content: string;
  timestamp?: Date | number;
}

export function AssistantMessage({
  content,
  timestamp,
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
