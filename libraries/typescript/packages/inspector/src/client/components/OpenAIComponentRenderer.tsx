import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface OpenAIComponentRendererProps {
  componentUrl: string
  toolName: string
  toolArgs: Record<string, unknown>
  toolResult: any
  className?: string
}

function Wrapper({ children, className, noWrapper }: { children: React.ReactNode, className?: string, noWrapper?: boolean }) {
  if (noWrapper) {
    return children
  }
  return (
    <div className={cn('bg-zinc-100 dark:bg-zinc-900 bg-[radial-gradient(circle,_rgba(0,0,0,0.2)_1px,_transparent_1px)] dark:bg-[radial-gradient(circle,_rgba(255,255,255,0.2)_1px,_transparent_1px)] bg-[length:32px_32px]', className)}>
      {children}
    </div>
  )
}

/**
 * OpenAIComponentRenderer renders OpenAI Apps SDK components
 * Provides window.openai API bridge for component interaction via iframe
 */
export function OpenAIComponentRenderer({
  componentUrl: _componentUrl,
  toolName,
  toolArgs,
  toolResult,
  className,
  noWrapper = false,
}: OpenAIComponentRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [isReady, setIsReady] = useState(false)

  // Store stable references to avoid re-renders
  const toolArgsRef = useRef(toolArgs)
  const toolResultRef = useRef(toolResult)

  // Update refs when props change
  useEffect(() => {
    toolArgsRef.current = toolArgs
    toolResultRef.current = toolResult
  }, [toolArgs, toolResult])

  // Extract HTML content from the resource (using useMemo to avoid re-renders)
  const htmlContent = useMemo(() => {
    if (toolResult?.text && typeof toolResult.text === 'string') {
      return toolResult.text
    }
    else if (toolResult?.contents?.[0]?.text) {
      return toolResult.contents[0].text
    }
    return null
  }, [toolResult])

  const error = htmlContent ? null : 'No HTML content found in resource'

  // Handle postMessage communication with iframe
  useEffect(() => {
    if (!htmlContent)
      return

    const handleMessage = async (event: MessageEvent) => {
      // Only accept messages from our iframe
      if (
        !iframeRef.current
        || event.source !== iframeRef.current.contentWindow
      ) {
        return
      }

      switch (event.data.type) {
        case 'openai:setWidgetState':
          try {
            // Store widget state in localStorage
            const stateKey = `openai-widget-state:${toolName}`
            localStorage.setItem(stateKey, JSON.stringify(event.data.state))
          }
          catch (err) {
            console.error('[OpenAIComponentRenderer] Failed to save widget state:', err)
          }
          break

        case 'openai:callTool':
          // For now, just respond with error - in a full implementation this would call the tool
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: 'openai:callTool:response',
              requestId: event.data.requestId,
              error: 'Tool calls from widgets not yet supported in this inspector',
            },
            '*',
          )
          break

        case 'openai:sendFollowup':
          // Followup messages not yet supported
          break
      }
    }

    window.addEventListener('message', handleMessage)

    const handleLoad = () => {
      setIsReady(true)

      // Send initial data to the iframe
      if (iframeRef.current?.contentWindow) {
        // Get any saved widget state
        const stateKey = `openai-widget-state:${toolName}`
        const savedState = localStorage.getItem(stateKey)
        const widgetState = savedState ? JSON.parse(savedState) : undefined

        // Extract structured content from current refs
        const currentToolResult = toolResultRef.current
        let structuredContent = currentToolResult?.structuredContent
        if (!structuredContent && currentToolResult?.contents) {
          structuredContent = currentToolResult.structuredContent
        }

        // Send initialization message
        iframeRef.current.contentWindow.postMessage(
          {
            type: 'openai:init',
            toolInput: toolArgsRef.current,
            toolOutput: structuredContent || {},
            widgetState,
          },
          '*',
        )
      }
    }

    const handleError = () => {
      console.error('[OpenAIComponentRenderer] Failed to load iframe')
    }

    const iframe = iframeRef.current
    iframe?.addEventListener('load', handleLoad)
    iframe?.addEventListener('error', handleError)

    return () => {
      window.removeEventListener('message', handleMessage)
      iframe?.removeEventListener('load', handleLoad)
      iframe?.removeEventListener('error', handleError)
    }
  }, [htmlContent, toolName])

  if (error && !htmlContent) {
    return (
      <div className={className}>
        <div className="bg-red-50/30 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/50 rounded-lg p-4">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load component:
            {' '}
            {error}
          </p>
        </div>
      </div>
    )
  }

  if (!htmlContent) {
    return (
      <div className={className}>
        <div className="bg-yellow-50/30 dark:bg-yellow-950/20 border border-yellow-200/50 dark:border-yellow-800/50 rounded-lg p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">
            Loading component...
          </p>
        </div>
      </div>
    )
  }

  return (
    <Wrapper className={className} noWrapper={noWrapper}>
      {!isReady && (
        <div className="bg-blue-50/30 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/50 rounded-lg p-4 mb-2">
          <p className="text-sm text-blue-600 dark:text-blue-400">
            Loading component...
          </p>
        </div>
      )}

      <iframe
        ref={iframeRef}
        srcDoc={htmlContent}
        className={cn('w-full border rounded-3xl bg-white dark:bg-gray-900', noWrapper && 'h-[400px]')}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        title={`OpenAI Component: ${toolName}`}
        allow="web-share"
      />
    </Wrapper>
  )
}
