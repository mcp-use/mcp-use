import { useToolContext, useViewTheme } from "@mcp-use/server/react";

import "./view.css";

const rootClass =
  "p-4 font-sans bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100";

interface Paragraph {
  text: string;
  /**
   * Character offset of the paragraph within the story. The story only grows
   * (text streams in append-only), so the offset is a stable identity for
   * each paragraph across renders — unlike an array index, which would shift
   * if paragraphs were ever inserted or removed.
   */
  offset: number;
}

function splitParagraphs(story: string | undefined): Paragraph[] {
  if (typeof story !== "string" || story.length === 0) return [];
  const paragraphs: Paragraph[] = [];
  let offset = 0;
  // Splitting on a capture group keeps the separators, alternating
  // [text, separator, text, …], so each part's offset can be tracked.
  const parts = story.split(/(\n\n+)/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const isSeparator = i % 2 === 1;
    if (!isSeparator && part.length > 0) {
      paragraphs.push({ text: part, offset });
    }
    offset += part.length;
  }
  return paragraphs;
}

function StatusLine({ label }: { label: string }) {
  return (
    <p className="m-0 text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
      {label}
    </p>
  );
}

function StoryBody({
  title,
  story,
  showCaret,
}: {
  title: string | undefined;
  story: string | undefined;
  showCaret: boolean;
}) {
  const paragraphs = splitParagraphs(story);
  const heading =
    typeof title === "string" && title.length > 0 ? title : "—";

  return (
    <>
      <h1 className="m-0 mb-4 text-2xl font-semibold tracking-tight">
        {heading}
      </h1>
      <div className="flex flex-col gap-3 text-base leading-relaxed text-neutral-800 dark:text-neutral-200">
        {paragraphs.length === 0 ? (
          showCaret ? (
            <p className="m-0">
              <span className="story-caret" aria-hidden="true" />
            </p>
          ) : null
        ) : (
          paragraphs.map((paragraph, index) => {
            const isLast = index === paragraphs.length - 1;
            return (
              <p key={paragraph.offset} className="m-0 whitespace-pre-wrap">
                {paragraph.text}
                {showCaret && isLast ? (
                  <span className="story-caret" aria-hidden="true" />
                ) : null}
              </p>
            );
          })
        )}
      </div>
    </>
  );
}

export default function StoryWriter() {
  const ctx = useToolContext<"write-story">();
  const theme = useViewTheme();
  const root = theme === "dark" ? `dark ${rootClass}` : rootClass;

  if (ctx.status === "pending" && ctx.toolInput === undefined) {
    return (
      <div className={root}>
        <p className="m-0 text-sm text-neutral-500 dark:text-neutral-400">
          Waiting for the story to begin…
        </p>
      </div>
    );
  }

  if (ctx.status === "pending") {
    return (
      <div className={root} aria-busy="true">
        <div className="mb-4">
          <StatusLine label="Writing…" />
        </div>
        <StoryBody
          title={ctx.toolInput?.title}
          story={ctx.toolInput?.story}
          showCaret
        />
      </div>
    );
  }

  if (ctx.status === "error") {
    return (
      <div className={root} role="alert">
        <p className="m-0 font-medium">Story failed</p>
        <p className="mt-2 mb-0 text-sm text-neutral-600 dark:text-neutral-400">
          {ctx.error.message}
        </p>
      </div>
    );
  }

  // status === "ready"
  const title =
    typeof ctx.toolInput?.title === "string" && ctx.toolInput.title.length > 0
      ? ctx.toolInput.title
      : ctx.toolOutput.title;
  const wordCount = ctx.toolOutput.wordCount;

  return (
    <div className={root}>
      <StoryBody
        title={title}
        story={ctx.toolInput?.story}
        showCaret={false}
      />
      <footer className="mt-6 border-t border-neutral-200 pt-3 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        {wordCount} {wordCount === 1 ? "word" : "words"}
      </footer>
    </div>
  );
}
