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

function getRoleDisplayName(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

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
