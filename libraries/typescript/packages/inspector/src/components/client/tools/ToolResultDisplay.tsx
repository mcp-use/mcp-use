import { usePrismTheme } from '@/client/hooks/usePrismTheme'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Check, Clock, Copy, Maximize, Trash2 } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { isMcpUIResource, McpUIRenderer } from '../McpUIRenderer'

export interface ToolResult {
  toolName: string
  args: Record<string, unknown>
  result: any
  error?: string
  timestamp: number
  duration?: number
}

interface ToolResultDisplayProps {
  results: ToolResult[]
  copiedResult: number | null
  previewMode: boolean
  onCopy: (index: number, result: any) => void
  onDelete: (index: number) => void
  onFullscreen: (index: number) => void
  onTogglePreview: () => void
}

export function ToolResultDisplay({
  results,
  copiedResult,
  previewMode,
  onCopy,
  onDelete,
  onFullscreen,
  onTogglePreview,
}: ToolResultDisplayProps) {
  const { prismStyle } = usePrismTheme()

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Clock className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400 mb-2">No results yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Execute a tool to see results here
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto h-full overscroll-contain">
      <div className="space-y-4 p-4">
        {results.map((result, index) => {
          const resultKey = `${result.toolName}-${result.timestamp}`
          const content = result.result?.content || []
          const mcpUIResources = content.filter(
            (item: any) =>
              item.type === 'resource' && isMcpUIResource(item.resource)
          )
          const hasMcpUIResources = mcpUIResources.length > 0

          return (
            <div
              key={resultKey}
              className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden shadow-sm"
            >
              <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">
                    {result.toolName}
                  </h3>
                  <Badge variant="outline" className="text-xs">
                    {new Date(result.timestamp).toLocaleTimeString()}
                  </Badge>
                  {result.duration && (
                    <Badge
                      variant="outline"
                      className="text-xs text-green-600 dark:text-green-400"
                    >
                      {result.duration}ms
                    </Badge>
                  )}
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={onTogglePreview}
                          className={
                            previewMode
                              ? 'text-purple-600 dark:text-purple-400'
                              : ''
                          }
                        >
                          {previewMode ? 'JSON' : 'Preview'}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {previewMode
                          ? 'Switch to JSON view'
                          : 'Switch to preview mode'}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCopy(index, result.result)}
                      >
                        {copiedResult === index ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy result</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(index)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete result</TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onFullscreen(index)}
                  >
                    <Maximize className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {result.error ? (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mx-4">
                  <p className="text-red-800 dark:text-red-300 font-medium">
                    Error:
                  </p>
                  <p className="text-red-700 dark:text-red-400 text-sm">
                    {result.error}
                  </p>
                </div>
              ) : (
                (() => {
                  if (hasMcpUIResources) {
                    if (previewMode) {
                      return (
                        <div className="space-y-0 h-full">
                          {mcpUIResources.map((item: any, idx: number) => (
                            <div key={idx} className="mx-0 size-full">
                              <div className="w-full h-full">
                                <McpUIRenderer
                                  resource={item.resource}
                                  onUIAction={(_action) => {
                                    // Handle UI actions here if needed
                                  }}
                                  className="w-full h-full"
                                />
                              </div>
                            </div>
                          ))}
                          {/* Show JSON for non-UI content */}
                          {content.filter(
                            (item: any) =>
                              !(
                                item.type === 'resource' &&
                                isMcpUIResource(item.resource)
                              )
                          ).length > 0 && (
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
                                {JSON.stringify(
                                  content.filter(
                                    (item: any) =>
                                      !(
                                        item.type === 'resource' &&
                                        isMcpUIResource(item.resource)
                                      )
                                  ),
                                  null,
                                  2
                                )}
                              </SyntaxHighlighter>
                            </div>
                          )}
                        </div>
                      )
                    } else {
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
                  } else {
                    // No MCP UI resources, show JSON
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
                })()
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
