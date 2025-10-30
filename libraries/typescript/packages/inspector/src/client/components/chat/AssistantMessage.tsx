import { Check, Copy } from 'lucide-react'
import Markdown from 'markdown-to-jsx'
import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { usePrismTheme } from '@/client/hooks/usePrismTheme'

// Custom code block component for syntax highlighting
function CodeBlock({ children, className }: { children: string, className?: string }) {
  const { prismStyle } = usePrismTheme()
  const language = className?.replace('lang-', '') || 'text'
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <div className="my-4 relative group/code">
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
          {isCopied
            ? (
                <Check className="h-3.5 w-3.5" />
              )
            : (
                <Copy className="h-3.5 w-3.5" />
              )}
        </button>
      </div>

      <SyntaxHighlighter
        language={language}
        style={prismStyle}
        customStyle={{
          margin: 0,
          padding: '1rem',
          paddingTop: '2rem',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          background: 'var(--muted)',
        }}
        className="text-sm"
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

// Custom inline code component
function InlineCode({ children }: { children: string }) {
  return (
    <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
      {children}
    </code>
  )
}

// Markdown renderer component using markdown-to-jsx
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <Markdown
      options={{
        overrides: {
          code: CodeBlock,
          pre: ({ children }: { children: React.ReactNode }) => <>{children}</>,
          inlineCode: InlineCode,
          h1: ({ children }: { children: React.ReactNode }) => (
            <h1 className="text-xl font-bold text-foreground mb-2 mt-4">{children}</h1>
          ),
          h2: ({ children }: { children: React.ReactNode }) => (
            <h2 className="text-lg font-bold text-foreground mb-2 mt-4">{children}</h2>
          ),
          h3: ({ children }: { children: React.ReactNode }) => (
            <h3 className="text-base font-bold text-foreground mb-2 mt-4">{children}</h3>
          ),
          h4: ({ children }: { children: React.ReactNode }) => (
            <h4 className="text-sm font-bold text-foreground mb-2 mt-4">{children}</h4>
          ),
          h5: ({ children }: { children: React.ReactNode }) => (
            <h5 className="text-sm font-bold text-foreground mb-2 mt-4">{children}</h5>
          ),
          h6: ({ children }: { children: React.ReactNode }) => (
            <h6 className="text-sm font-bold text-foreground mb-2 mt-4">{children}</h6>
          ),
          p: ({ children }: { children: React.ReactNode }) => (
            <p className="text-foreground mb-2 leading-relaxed">{children}</p>
          ),
          ul: ({ children }: { children: React.ReactNode }) => (
            <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>
          ),
          ol: ({ children }: { children: React.ReactNode }) => (
            <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>
          ),
          li: ({ children }: { children: React.ReactNode }) => (
            <li className="text-foreground">{children}</li>
          ),
          blockquote: ({ children }: { children: React.ReactNode }) => (
            <blockquote className="border-l-4 border-muted-foreground pl-4 italic text-muted-foreground mb-3">
              {children}
            </blockquote>
          ),
          a: ({ children, href }: { children: React.ReactNode, href?: string }) => (
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
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }: { children: React.ReactNode }) => (
            <em className="italic text-foreground">{children}</em>
          ),
        },
      }}
    >
      {content}
    </Markdown>
  )
}

function CopyButton({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <button
      className="opacity-0 group-hover/message:opacity-100 transition-opacity text-muted-foreground hover:text-foreground text-xs flex items-center gap-1"
      onClick={handleCopy}
      title="Copy message content"
    >
      {isCopied
        ? (
            <Check className="h-3.5 w-3.5" />
          )
        : (
            <Copy className="h-3.5 w-3.5" />
          )}
    </button>
  )
}

interface AssistantMessageProps {
  content: string
  timestamp?: Date | number
}

export function AssistantMessage({
  content,
  timestamp,
}: AssistantMessageProps) {
  if (!content || content.length === 0) {
    return null
  }

  return (
    <div className="flex items-start gap-6 group/message relative">
      <div className="flex-1 min-w-0">
        <div className="break-words">
          <div className="text-base leading-7 font-sans text-start break-words transition-all duration-300 ease-in-out">
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
  )
}
