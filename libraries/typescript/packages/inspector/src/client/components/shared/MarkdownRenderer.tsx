import { Check, Copy } from "lucide-react";
import Markdown from "markdown-to-jsx";
import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { usePrismTheme } from "@/client/hooks/usePrismTheme";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";

/**
 * Render a syntax-highlighted code block with a language badge and a copy-to-clipboard control.
 *
 * Detects the language from `className` (supports patterns like `lang-<lang>`, `language-<lang>`, or space-separated class lists) and falls back to `"text"` when not found.
 *
 * @param children - The code content to render.
 * @param className - Optional class string used to infer the code language (e.g., `"lang-typescript"`, `"language-bash"`, or `"bash lang-bash"`).
 * @returns The rendered code block element with syntax highlighting, a language label, and a copy button that copies the code to the clipboard.
 */
function CodeBlock({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const { prismStyle } = usePrismTheme();
  // Handle both "lang-" and "language-" prefixes, and extract just the language name
  // className can be like "lang-typescript", "language-typescript", or even "bash lang-bash"
  let language = "text";
  if (className) {
    // Try to extract language from patterns like "lang-X" or "language-X"
    const match = className.match(/(?:lang(?:uage)?-)(\w+)/);
    if (match) {
      language = match[1];
    } else {
      // Fallback: just use the className as-is after removing common prefixes
      language = className.replace(/^(lang-|language-)\s*/, "").trim();
    }
  }
  const [isCopied, setIsCopied] = useState(false);

  // Ensure children is a string
  const codeContent = String(children).trim();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="my-4 relative group/code bg-muted rounded-md p-0">
      {/* Language badge and copy button */}
      <div className="flex items-center justify-between mb-2 absolute top-0 left-0 w-full">
        <div className="text-[10px] font-mono text-muted-foreground/50 bg-transparent px-2 py-0 rounded">
          {language}
        </div>
        <button
          className="opacity-0 group-hover/code:opacity-100 transition-opacity text-muted-foreground hover:text-foreground text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-muted"
          onClick={handleCopy}
          title="Copy code"
        >
          {isCopied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <SyntaxHighlighter
        language={language}
        style={prismStyle}
        customStyle={{
          margin: 0,
          padding: "1rem",
          paddingTop: "2rem",
          borderRadius: "0.5rem",
          fontSize: "0.875rem",
          background: "var(--muted)",
        }}
        className="text-sm"
      >
        {codeContent}
      </SyntaxHighlighter>
    </div>
  );
}

/**
 * Renders inline code with muted background, padding, rounded corners, and monospaced font.
 *
 * @param children - The code text to render inside the inline element.
 * @returns The styled inline `code` element for displaying short code snippets within text.
 */
function InlineCode({ children }: { children: string }) {
  return (
    <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
      {children}
    </code>
  );
}

// Smart code component that differentiates between inline and block code
// - If it has a className (e.g., lang-typescript), it's a multiline code block
/**
 * Renders either a fenced code block or inline code depending on whether a `className` is present.
 *
 * @param children - The code text to render.
 * @param className - Optional class name from the Markdown parser (e.g., `language-js`); when present the component renders a block code view and uses this value to infer the language.
 * @returns The rendered code block component when `className` is provided, otherwise an inline code element.
 */
function Code({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  // If there's a className, it's a code block from triple backticks
  if (className) {
    return <CodeBlock className={className}>{children}</CodeBlock>;
  }

  // Otherwise, it's inline code from single backticks
  return <InlineCode>{children}</InlineCode>;
}

/**
 * Renders a list item that recognizes GitHub-style task list syntax and displays a disabled checkbox when present.
 *
 * When the content starts with `[ ]` or `[x]` (case-insensitive) the component renders a disabled checkbox reflecting the checked state and the remaining text; otherwise it renders the children unchanged.
 *
 * @param children - The list item's content; may be a string, an array of nodes, or other React nodes. If a string (or an array whose first element is a string) beginning with `[ ]` or `[x]`, the component interprets it as a task list item.
 * @returns A list item element that either includes a disabled checkbox for task list items or renders the provided children as-is.
 */
function ListItem({ children }: { children: React.ReactNode }) {
  // Check if this is a task list item (starts with [ ] or [x])
  if (typeof children === "string") {
    const checkboxMatch = children.match(/^\[([ xX])\]\s*(.*)/);
    if (checkboxMatch) {
      const isChecked = checkboxMatch[1].toLowerCase() === "x";
      const text = checkboxMatch[2];
      return (
        <li className="text-foreground flex items-center gap-2">
          <Checkbox checked={isChecked} disabled />
          <span>{text}</span>
        </li>
      );
    }
  }

  // Check if children is an array with checkbox pattern
  if (Array.isArray(children) && children.length > 0) {
    const firstChild = children[0];
    if (typeof firstChild === "string") {
      const checkboxMatch = firstChild.match(/^\[([ xX])\]\s*(.*)/);
      if (checkboxMatch) {
        const isChecked = checkboxMatch[1].toLowerCase() === "x";
        const text = checkboxMatch[2];
        return (
          <li className="text-foreground flex items-center gap-2">
            <Checkbox checked={isChecked} disabled />
            <span>
              {text}
              {children.slice(1)}
            </span>
          </li>
        );
      }
    }
  }

  return <li className="text-foreground">{children}</li>;
}

interface MarkdownRendererProps {
  content: string;
}

/**
 * Render Markdown content using custom UI components and styling.
 *
 * Renders the provided Markdown string into a styled React element tree with support for fenced code blocks (syntax highlighting and copy), inline code, tables, task list checkboxes, blockquotes, images, links, headings, lists, and other common Markdown elements.
 *
 * @param content - The Markdown source to render
 * @returns The rendered React element tree representing the parsed Markdown content
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <Markdown
      options={{
        overrides: {
          code: Code,
          pre: ({ children }: { children: React.ReactNode }) => <>{children}</>,
          h1: ({ children }: { children: React.ReactNode }) => (
            <h1 className="text-xl font-bold text-foreground mb-2 mt-4">
              {children}
            </h1>
          ),
          h2: ({ children }: { children: React.ReactNode }) => (
            <h2 className="text-lg font-bold text-foreground mb-2 mt-4">
              {children}
            </h2>
          ),
          h3: ({ children }: { children: React.ReactNode }) => (
            <h3 className="text-base font-bold text-foreground mb-2 mt-4">
              {children}
            </h3>
          ),
          h4: ({ children }: { children: React.ReactNode }) => (
            <h4 className="text-sm font-bold text-foreground mb-2 mt-4">
              {children}
            </h4>
          ),
          h5: ({ children }: { children: React.ReactNode }) => (
            <h5 className="text-sm font-bold text-foreground mb-2 mt-4">
              {children}
            </h5>
          ),
          h6: ({ children }: { children: React.ReactNode }) => (
            <h6 className="text-sm font-bold text-foreground mb-2 mt-4">
              {children}
            </h6>
          ),
          p: ({ children }: { children: React.ReactNode }) => (
            <p className="text-foreground mb-2 leading-relaxed">{children}</p>
          ),
          ul: ({ children }: { children: React.ReactNode }) => (
            <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>
          ),
          ol: ({ children }: { children: React.ReactNode }) => (
            <ol className="list-decimal list-inside mb-3 space-y-1">
              {children}
            </ol>
          ),
          li: ListItem,
          table: ({ children }: { children: React.ReactNode }) => (
            <div className="my-4">
              <Table>{children}</Table>
            </div>
          ),
          thead: ({ children }: { children: React.ReactNode }) => (
            <TableHeader>{children}</TableHeader>
          ),
          tbody: ({ children }: { children: React.ReactNode }) => (
            <TableBody>{children}</TableBody>
          ),
          tr: ({ children }: { children: React.ReactNode }) => (
            <TableRow>{children}</TableRow>
          ),
          th: ({ children }: { children: React.ReactNode }) => (
            <TableHead>{children}</TableHead>
          ),
          td: ({ children }: { children: React.ReactNode }) => (
            <TableCell>{children}</TableCell>
          ),
          blockquote: ({ children }: { children: React.ReactNode }) => (
            <blockquote className="border-l-4 border-muted-foreground pl-4 italic text-muted-foreground mb-3">
              {children}
            </blockquote>
          ),
          a: ({
            children,
            href,
          }: {
            children: React.ReactNode;
            href?: string;
          }) => (
            <a
              href={href}
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          strong: ({ children }: { children: React.ReactNode }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          em: ({ children }: { children: React.ReactNode }) => (
            <em className="italic text-foreground">{children}</em>
          ),
          img: ({ src, alt }: { src?: string; alt?: string }) => (
            <img
              src={src}
              alt={alt || ""}
              className="max-w-full max-h-[500px] object-contain rounded-lg my-4 border border-border"
              loading="lazy"
            />
          ),
          hr: () => <hr className="my-4 border-t border-border" />,
        },
      }}
    >
      {content}
    </Markdown>
  );
}