import { Brush, Code, Copy, Download, Maximize } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { Badge } from '@/client/components/ui/badge'
import { Button } from '@/client/components/ui/button'
import { usePrismTheme } from '@/client/hooks/usePrismTheme'
import { isMcpUIResource, McpUIRenderer } from '../McpUIRenderer'

export interface ResourceResult {
  uri: string
  result: any
  error?: string
  timestamp: number
}

interface ResourceResultDisplayProps {
  result: ResourceResult | null
  isLoading: boolean
  previewMode: boolean
  onTogglePreview: () => void
  onCopy: () => void
  onDownload: () => void
  onFullscreen: () => void
}

export function ResourceResultDisplay({
  result,
  isLoading,
  previewMode,
  onTogglePreview,
  onCopy,
  onDownload,
  onFullscreen,
}: ResourceResultDisplayProps) {
  const { prismStyle } = usePrismTheme()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Loading resource...
          </p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          Select a resource to view its contents
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Choose a resource from the list to see its data
        </p>
      </div>
    )
  }

  if (result.error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
          <p className="text-red-800 dark:text-red-300 font-medium">Error:</p>
          <p className="text-red-700 dark:text-red-400 text-sm">
            {result.error}
          </p>
        </div>
      </div>
    )
  }

  // Check if we have MCP UI resources
  const hasMcpUIResources
    = result.result.contents
      && Array.isArray(result.result.contents)
      && result.result.contents.some(
        (item: any) => item.mimeType && isMcpUIResource(item),
      )

  const mcpUIResources = hasMcpUIResources
    ? result.result.contents.filter(
        (item: any) => item.mimeType && isMcpUIResource(item),
      )
    : []

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {new Date(result.timestamp).toLocaleTimeString()}
          </Badge>
          {hasMcpUIResources && (
            <Badge
              variant="outline"
              className="text-xs text-purple-600 dark:text-purple-400"
            >
              MCP UI
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasMcpUIResources && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onTogglePreview}
              className={
                !previewMode ? 'text-purple-600 dark:text-purple-400' : ''
              }
            >
              {previewMode ? <Code className="h-4 w-4 mr-1" /> : <Brush className="h-4 w-4 mr-1" />}
              {previewMode ? 'JSON' : 'Preview'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCopy}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDownload}>
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onFullscreen}>
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {(() => {
          if (hasMcpUIResources) {
            if (previewMode) {
              return (
                <div className="space-y-0 h-full">
                  {mcpUIResources.map((resource: any, _idx: number) => (
                    <div
                      key={`mcp-ui-${
                        resource.uri
                        || `resource-${Date.now()}-${Math.random()}`
                      }`}
                      className="mx-0 size-full"
                    >
                      <div className="w-full h-full">
                        <McpUIRenderer
                          resource={resource}
                          onUIAction={(_action) => {
                            // Handle UI actions here if needed
                          }}
                          className="w-full h-full"
                        />
                      </div>
                    </div>
                  ))}
                  {/* Show JSON for non-UI content */}
                  {(() => {
                    if (
                      result.result.contents
                      && Array.isArray(result.result.contents)
                    ) {
                      const nonUIResources = result.result.contents.filter(
                        (item: any) => !(item.mimeType && isMcpUIResource(item)),
                      )
                      if (nonUIResources.length > 0) {
                        return (
                          <div className="px-4">
                            <SyntaxHighlighter
                              language="json"
                              style={prismStyle}
                              customStyle={{
                                margin: 0,
                                padding: 0,
                                border: 'none',
                                borderRadius: 0,
                                fontSize: '1rem',
                                background: 'transparent',
                              }}
                              className="text-gray-900 dark:text-gray-100"
                            >
                              {JSON.stringify(nonUIResources, null, 2)}
                            </SyntaxHighlighter>
                          </div>
                        )
                      }
                    }
                    return null
                  })()}
                </div>
              )
            }
            else {
              // JSON mode for MCP UI resources
              return (
                <div className="px-4 pt-4">
                  <SyntaxHighlighter
                    language="json"
                    style={prismStyle}
                    customStyle={{
                      margin: 0,
                      padding: 0,
                      border: 'none',
                      borderRadius: 0,
                      fontSize: '1rem',
                      background: 'transparent',
                    }}
                    className="text-gray-900 dark:text-gray-100"
                  >
                    {JSON.stringify(result.result, null, 2)}
                  </SyntaxHighlighter>
                </div>
              )
            }
          }

          // Default: show JSON for non-MCP UI resources
          return (
            <div className="px-4 pt-4">
              <SyntaxHighlighter
                language="json"
                style={prismStyle}
                customStyle={{
                  margin: 0,
                  padding: 0,
                  border: 'none',
                  borderRadius: 0,
                  fontSize: '1rem',
                  background: 'transparent',
                }}
                className="text-gray-900 dark:text-gray-100"
              >
                {JSON.stringify(result.result, null, 2)}
              </SyntaxHighlighter>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
