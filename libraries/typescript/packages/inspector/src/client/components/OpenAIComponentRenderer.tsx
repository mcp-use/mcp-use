import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from './ui/spinner'

interface OpenAIComponentRendererProps {
  componentUrl: string
  toolName: string
  toolArgs: Record<string, unknown>
  toolResult: any
  serverId: string
  readResource: (uri: string) => Promise<any>
  className?: string
  noWrapper?: boolean
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
  componentUrl,
  toolName,
  toolArgs,
  toolResult,
  serverId,
  readResource,
  className,
  noWrapper = false,
}: OpenAIComponentRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null)

  // Generate unique tool ID
  const toolIdRef = useRef(`tool-${Date.now()}-${Math.random().toString(36).substring(7)}`)
  const toolId = toolIdRef.current

  // Store widget data and set up iframe URL
  useEffect(() => {
    const storeAndSetUrl = async () => {
      try {
        // Extract structured content from tool result
        let structuredContent = null
        if (toolResult?.structuredContent) {
          structuredContent = toolResult.structuredContent
        }
        else if (Array.isArray(toolResult) && toolResult[0]) {
          const firstResult = toolResult[0]
          if (firstResult.output?.value?.structuredContent) {
            structuredContent = firstResult.output.value.structuredContent
          }
          else if (firstResult.structuredContent) {
            structuredContent = firstResult.structuredContent
          }
          else if (firstResult.output?.value) {
            structuredContent = firstResult.output.value
          }
        }

        // Fallback to entire result
        if (!structuredContent) {
          structuredContent = toolResult
        }

        // Fetch the HTML resource client-side (where the connection exists)
        const resourceData = await readResource(componentUrl)

        // Store widget data on server (including the fetched HTML)
        const storeResponse = await fetch('/inspector/api/resources/widget/store', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            serverId,
            uri: componentUrl,
            toolInput: toolArgs,
            toolOutput: structuredContent,
            resourceData, // Pass the fetched HTML
            toolId,
          }),
        })

        if (!storeResponse.ok) {
          const errorData = await storeResponse.json().catch(() => ({ error: 'Unknown error' }))
          throw new Error(`Failed to store widget data: ${errorData.error || storeResponse.statusText}`)
        }

        // Set widget URL directly to content endpoint (skip container page)
        setWidgetUrl(`/inspector/api/resources/widget-content/${toolId}`)
      }
      catch (error) {
        console.error('Error storing widget data:', error)
        setError(
          error instanceof Error ? error.message : 'Failed to prepare widget',
        )
      }
    }

    storeAndSetUrl()
  }, [componentUrl, serverId, toolArgs, toolResult, toolId, readResource])

  // Handle postMessage communication with iframe
  useEffect(() => {
    if (!widgetUrl)
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
            // Widget state is already handled by the server-injected script
            // This is just for parent-level awareness if needed
          }
          catch (err) {
            console.error('[OpenAIComponentRenderer] Failed to handle widget state:', err)
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
      setError(null)
    }

    const handleError = () => {
      setError('Failed to load component')
    }

    const iframe = iframeRef.current
    iframe?.addEventListener('load', handleLoad)
    iframe?.addEventListener('error', handleError as any)

    return () => {
      window.removeEventListener('message', handleMessage)
      iframe?.removeEventListener('load', handleLoad)
      iframe?.removeEventListener('error', handleError as any)
    }
  }, [widgetUrl])

  if (error) {
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

  if (!widgetUrl) {
    return (
      <Wrapper className={className} noWrapper={noWrapper}>
        <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full">
          <Spinner className="size-5" />
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper className={className} noWrapper={noWrapper}>
      {!isReady && (
        <div className="flex absolute left-0 top-0 items-center justify-center w-full h-full">
          <Spinner className="size-5" />
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={widgetUrl}
        className={cn('w-full border rounded-3xl bg-white', noWrapper && 'h-[400px]')}
        style={{
          minHeight: '400px',
          height: '600px',
          maxHeight: '80vh',
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        title={`OpenAI Component: ${toolName}`}
        allow="web-share"
      />
    </Wrapper>
  )
}
