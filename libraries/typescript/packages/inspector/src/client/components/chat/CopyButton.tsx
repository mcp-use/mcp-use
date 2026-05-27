import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyToClipboard } from "@/client/utils/clipboard";

/**
 * Button that copies the provided text to the clipboard and shows a brief visual confirmation.
 *
 * @param text - The string content to copy when the button is clicked.
 * @returns A button element that copies `text` to the clipboard and displays a check icon for two seconds after a successful copy.
 */
export function CopyButton({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    await copyToClipboard(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <button
      className="opacity-0 group-hover/message:opacity-100 transition-opacity text-muted-foreground hover:text-foreground text-xs flex items-center gap-1"
      onClick={handleCopy}
      title="Copy message content"
      data-testid="copy-button"
    >
      {isCopied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
