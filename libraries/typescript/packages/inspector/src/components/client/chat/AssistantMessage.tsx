import { AnimatedMarkdown } from 'flowtoken'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

function CopyButton({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <button
      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground text-xs flex items-center gap-1"
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
  isStreaming?: boolean
}

export function AssistantMessage({
  content,
  timestamp,
  isStreaming = false,
}: AssistantMessageProps) {
  if (!content || content.length === 0) {
    return null
  }

  return (
    <div className="flex items-start gap-6 group relative">
      <div className="flex-1 min-w-0">
        <div className="break-words">
          <div className="prose prose-sm max-w-none dark:prose-invert text-base leading-7 font-sans text-start break-words prose-pre:p-0 prose-pre:m-0 prose-pre:bg-transparent transition-all duration-300 ease-in-out">
            <AnimatedMarkdown
              content={content}
              animation="fadeIn"
              animationDuration="0.5s"
            />
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
