import { memo, useMemo } from "react";
import { Streamdown, parseMarkdownIntoBlocks } from "streamdown";
import { slimCode } from "./streamdown-code-slim";
import { cn } from "@/client/lib/utils";

/** ponytail: remount when block boundaries shift — Streamdown keys blocks by index only. */
function streamingStructureKey(content: string): string {
  return parseMarkdownIntoBlocks(content)
    .map((block, i) => `${i}:${block.length}:${block.charCodeAt(0) ?? 0}`)
    .join("|");
}

const streamdownPlugins = { code: slimCode };

/** stagger: 0 — default 40ms staggers per-block and causes out-of-order reveals (streamdown#482). */
const streamdownAnimated = {
  animation: "fadeIn" as const,
  duration: 200,
  easing: "ease-out",
  sep: "word" as const,
  stagger: 0,
};

interface StreamingAssistantContentProps {
  content: string;
  isStreaming?: boolean;
}

export const StreamingAssistantContent = memo(
  function StreamingAssistantContent({
    content,
    isStreaming = false,
  }: StreamingAssistantContentProps) {
    const structureKey = useMemo(
      () => (isStreaming ? streamingStructureKey(content) : "static"),
      [content, isStreaming]
    );

    return (
      <Streamdown
        key={structureKey}
        className={cn(
          "text-[14px] leading-relaxed text-foreground",
          "[&_p]:mb-2 [&_p:last-child]:mb-0",
          "[&_pre]:my-3 [&_ul]:mb-2 [&_ol]:mb-2"
        )}
        plugins={streamdownPlugins}
        animated={streamdownAnimated}
        isAnimating={isStreaming}
        parseIncompleteMarkdown={isStreaming}
        lineNumbers={false}
        mode={isStreaming ? "streaming" : "static"}
      >
        {content}
      </Streamdown>
    );
  }
);
