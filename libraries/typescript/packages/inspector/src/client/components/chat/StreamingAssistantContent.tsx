import { memo, useMemo } from "react";
import { MarkdownRenderer } from "@/client/components/shared/MarkdownRenderer";
import { cn } from "@/client/lib/utils";

/** Close an odd ``` count so in-progress fenced blocks still render. */
function prepareStreamingMarkdown(content: string): string {
  const fences = content.match(/```/g);
  if (fences && fences.length % 2 === 1) {
    return `${content}\n\`\`\``;
  }
  return content;
}

interface StreamingAssistantContentProps {
  content: string;
  isStreaming?: boolean;
}

export const StreamingAssistantContent = memo(
  function StreamingAssistantContent({
    content,
    isStreaming = false,
  }: StreamingAssistantContentProps) {
    const markdown = useMemo(
      () => (isStreaming ? prepareStreamingMarkdown(content) : content),
      [content, isStreaming]
    );

    return (
      <div>
        <MarkdownRenderer
          className={cn(
            "text-[14px] leading-relaxed text-foreground",
            "[&_p]:mb-2 [&_p:last-child]:mb-0",
            "[&_pre]:my-3 [&_ul]:mb-2 [&_ol]:mb-2"
          )}
          content={markdown}
        />
        {isStreaming ? (
          <span
            className="inline-block w-0.5 h-[1em] ml-0.5 -mt-1 align-middle bg-foreground/60 animate-pulse"
            aria-hidden
          />
        ) : null}
      </div>
    );
  }
);
