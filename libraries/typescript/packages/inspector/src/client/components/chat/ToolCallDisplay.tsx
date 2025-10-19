import { Check, Copy, Loader2, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/client/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/client/components/ui/sheet'
import { cn } from '@/lib/utils'

interface ToolCallDisplayProps {
  toolName: string
  args: Record<string, unknown>
  result?: any
  state?: 'call' | 'result' | 'error'
}

export function ToolCallDisplay({
  toolName,
  args,
  result,
  state = 'result',
}: ToolCallDisplayProps) {
  const [_copied, setCopied] = useState(false)

  const getStatusIcon = () => {
    switch (state) {
      case 'call':
        return (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500 dark:text-blue-400" />
        )
      case 'result':
        return (
          <Check className="h-4 w-4 text-emerald-800 dark:text-emerald-400" />
        )
      case 'error':
        return <X className="h-4 w-4 text-red-500 dark:text-red-400" />
      default:
        return (
          <Check className="h-4 w-4 text-emerald-800 dark:text-emerald-400" />
        )
    }
  }

  const getStatusBg = () => {
    switch (state) {
      case 'call':
        return ' bg-blue-500/20 dark:bg-blue-500/20'
      case 'result':
        return ' bg-emerald-500/20 dark:bg-emerald-500/20'
      case 'error':
        return ' bg-red-500/20 dark:bg-red-500/20'
      default:
        return ' bg-emerald-500/20 dark:bg-emerald-500/20'
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatContent = (content: any): string => {
    if (typeof content === 'object') {
      return JSON.stringify(content, null, 2)
    }
    return String(content)
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <div className="flex max-w-min items-center gap-3 p-1 rounded-full border bg-card hover:bg-accent/50 transition-colors cursor-pointer my-4">
          {/* Tool Icon */}
          <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shrink-0">
            <Wrench className="size-4 text-muted-foreground" />
          </div>

          {/* Tool Name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {toolName}(
                {Object.keys(args).length > 0 ? (
                  <span className="bg-muted-foreground/20 rounded-full px-1.5 mx-1 py-0.5 text-xs">
                    {Object.keys(args).length} args
                  </span>
                ) : (
                  ''
                )}
                )
              </span>
            </div>
          </div>

          {/* Status Icon */}
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center',
              getStatusBg()
            )}
          >
            {getStatusIcon()}
          </div>
        </div>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-[400px] sm:w-[540px] p-4 overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Tool Call Details
          </SheetTitle>
          <SheetDescription>
            {toolName} -{state}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 py-4">
          {/* Arguments */}
          <div>
            <h3 className="text-sm font-medium mb-2">Arguments</h3>
            <div className="relative">
              <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto border font-mono leading-relaxed max-h-48 whitespace-pre-wrap break-words">
                {formatContent(args)}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(formatContent(args))}
                className="absolute top-2 right-2 h-6 w-6 p-0 opacity-70 hover:opacity-100"
                title="Copy arguments"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Result */}
          {result && (
            <div>
              <h3 className="text-sm font-medium mb-2">Result</h3>
              <div className="relative">
                <div
                  className={cn(
                    'p-3 rounded-lg border text-sm leading-relaxed max-h-48 overflow-x-auto whitespace-pre-wrap break-words max-w-full',
                    state === 'error'
                      ? 'bg-destructive/10 border-destructive/20 text-destructive-foreground'
                      : 'bg-muted/30 border-border'
                  )}
                >
                  {typeof result === 'string' ? (
                    result.startsWith('Error') ? (
                      <div className="font-mono">
                        <div className="font-semibold text-destructive mb-1">
                          Error:
                        </div>
                        <div className="whitespace-pre-wrap break-words">
                          {result.replace(/^Error:\s*/, '')}
                        </div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap font-mono break-words">
                        {result}
                      </div>
                    )
                  ) : (
                    <pre className="font-mono text-xs overflow-x-auto max-h-48 whitespace-pre-wrap break-words max-w-full">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(
                      typeof result === 'string'
                        ? result
                        : JSON.stringify(result, null, 2)
                    )
                  }
                  className="absolute top-2 right-2 h-6 w-6 p-0 opacity-70 hover:opacity-100"
                  title="Copy result"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
