import { Check, Clock, Copy, Zap } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { Button } from '@/client/components/ui/button'
import { usePrismTheme } from '@/client/hooks/usePrismTheme'
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
  onTogglePreview,
}: ToolResultDisplayProps) {
  const { prismStyle } = usePrismTheme()

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border-t dark:border-zinc-700">
      <div className="flex-1 overflow-y-auto h-full">
        {results.length > 0
          ? (
              <div className="space-y-4 flex-1 h-full">
                {results.map((result, index) => {
                  // Check if result contains MCP UI resources
                  const content = result.result?.content || []
                  const mcpUIResources = content.filter(
                    (item: any) =>
                      item.type === 'resource' && isMcpUIResource(item.resource),
                  )
                  const hasMcpUIResources = mcpUIResources.length > 0

                  return (
                    <div key={index} className="space-y-0 flex-1 h-full">
                      <div
                        className={`flex items-center gap-2 px-4 pt-2 ${
                          hasMcpUIResources
                            ? 'border-b border-gray-200 dark:border-zinc-600 pb-2'
                            : ''
                        }`}
                      >
                        <h3 className="text-sm font-medium">Response</h3>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(result.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        {result.duration !== undefined && (
                          <div className="flex items-center gap-1">
                            <Zap className="h-3 w-3 text-gray-400" />
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {result.duration}
                              ms
                            </span>
                          </div>
                        )}
                        {hasMcpUIResources && (
                          <div className="flex items-center gap-4 ml-4">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              URI:
                              {' '}
                              {mcpUIResources[0]?.resource?.uri || 'No URI'}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => onTogglePreview()}
                                className={`text-xs font-medium ${
                                  previewMode
                                    ? 'text-black dark:text-white'
                                    : 'text-zinc-500 dark:text-zinc-400'
                                }`}
                              >
                                Preview
                              </button>
                              <span className="text-xs text-zinc-400">|</span>
                              <button
                                onClick={() => onTogglePreview()}
                                className={`text-xs font-medium ${
                                  !previewMode
                                    ? 'text-black dark:text-white'
                                    : 'text-zinc-500 dark:text-zinc-400'
                                }`}
                              >
                                JSON
                              </button>
                            </div>
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onCopy(index, result.result)}
                          className="ml-auto"
                        >
                          {copiedResult === index
                            ? (
                                <Check className="h-4 w-4" />
                              )
                            : (
                                <Copy className="h-4 w-4" />
                              )}
                        </Button>
                      </div>

                      {result.error
                        ? (
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mx-4">
                              <p className="text-red-800 dark:text-red-300 font-medium">
                                Error:
                              </p>
                              <p className="text-red-700 dark:text-red-400 text-sm">
                                {result.error}
                              </p>
                            </div>
                          )
                        : (
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
                                            item.type === 'resource'
                                            && isMcpUIResource(item.resource)
                                          ),
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
                                                    item.type === 'resource'
                                                    && isMcpUIResource(item.resource)
                                                  ),
                                              ),
                                              null,
                                              2,
                                            )}
                                          </SyntaxHighlighter>
                                        </div>
                                      )}
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
                            })()
                          )}
                    </div>
                  )
                })}
              </div>
            )
          : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-gray-500 dark:text-gray-400">No results yet</p>
                  <p className="text-gray-400 dark:text-gray-500 text-sm">
                    Execute a tool to see results here
                  </p>
                </div>
              </div>
            )}
      </div>
    </div>
  )
}
