import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/client/components/ui/badge";
import { MarkdownRenderer } from "@/client/components/shared/MarkdownRenderer";
import { Button } from "@/client/components/ui/button";

interface PromptMessageContent {
  type: string;
  text?: string;
  mimeType?: string;
  data?: string;
  resource?: {
    uri: string;
    text?: string;
    mimeType?: string;
  };
}

interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: PromptMessageContent | string;
}

interface PromptMessageCardProps {
  message: PromptMessage;
  index: number;
}

/**
 * Selects the badge variant to use for a given message role.
 *
 * @param role - The message role; expected values are "system", "user", or "assistant"
 * @returns The badge variant name: `"default"` for system, `"outline"` for user (and unknown roles), or `"secondary"` for assistant
 */
function getRoleBadgeVariant(role: string) {
  switch (role) {
    case "system":
      return "default"; // Blue/primary
    case "user":
      return "outline"; // Gray outline
    case "assistant":
      return "secondary"; // Green/secondary
    default:
      return "outline";
  }
}

/**
 * Format a role identifier for display by capitalizing its first letter.
 *
 * @param role - Role identifier (e.g., "system", "user", "assistant")
 * @returns The input `role` with its first character converted to uppercase
 */
function getRoleDisplayName(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Extracts a plain-text representation from a prompt message content for display or copying.
 *
 * Handles string content, explicit text fields, resource text, image placeholders, and falls back
 * to a JSON-formatted string for other shapes.
 *
 * @param content - The message content to convert; may be a raw string or a structured PromptMessageContent.
 * @returns A plain string representation of `content`. For images returns a placeholder like `[Image: image/png]`.
 */
function extractTextFromContent(
  content: PromptMessageContent | string
): string {
  // If content is a string, return it directly
  if (typeof content === "string") {
    return content;
  }

  // If content has a text property
  if (content.text) {
    return content.text;
  }

  // If content is a resource with text
  if (content.type === "resource" && content.resource?.text) {
    return content.resource.text;
  }

  // For images, show a placeholder
  if (content.type === "image") {
    return `[Image: ${content.mimeType || "unknown type"}]`;
  }

  // For other types, try to stringify
  return JSON.stringify(content, null, 2);
}

/**
 * Render a styled card displaying a prompt message with a role badge and a copy-to-clipboard action.
 *
 * @param message - The prompt message to display (role and content).
 * @param index - The zero-based index of the message in the list.
 * @returns A JSX element representing the prompt message card.
 */
export function PromptMessageCard({ message, index }: PromptMessageCardProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    const text = extractTextFromContent(message.content);
    await navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const renderContent = () => {
    const content = message.content;

    // Handle string content
    if (typeof content === "string") {
      return <MarkdownRenderer content={content} />;
    }

    // Handle text content
    if (content.type === "text" && content.text) {
      return <MarkdownRenderer content={content.text} />;
    }

    // Handle image content
    if (content.type === "image") {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono bg-muted px-2 py-1 rounded">
            Image: {content.mimeType || "unknown type"}
          </span>
          {content.data && (
            <img
              src={`data:${content.mimeType};base64,${content.data}`}
              alt="Prompt image"
              className="max-w-full max-h-[300px] object-contain rounded-lg border border-border mt-2"
            />
          )}
        </div>
      );
    }

    // Handle resource content
    if (content.type === "resource" && content.resource) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground font-medium">Resource:</span>
            <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">
              {content.resource.uri}
            </code>
          </div>
          {content.resource.text && (
            <div className="mt-2">
              <MarkdownRenderer content={content.resource.text} />
            </div>
          )}
        </div>
      );
    }

    // Fallback: render as JSON
    return (
      <pre className="bg-muted p-3 rounded-lg text-sm overflow-x-auto">
        <code>{JSON.stringify(content, null, 2)}</code>
      </pre>
    );
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
      {/* Header with role badge and copy button */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
        <Badge variant={getRoleBadgeVariant(message.role)}>
          {getRoleDisplayName(message.role)}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-6 px-2"
          title="Copy message content"
        >
          {isCopied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Content */}
      <div className="px-4 py-3">{renderContent()}</div>
    </div>
  );
}