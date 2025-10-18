import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ToolsListProps {
  tools: Tool[]
  selectedTool: Tool | null
  onToolSelect: (tool: Tool) => void
  focusedIndex: number
}

export function ToolsList({
  tools,
  selectedTool,
  onToolSelect,
  focusedIndex,
}: ToolsListProps) {
  if (tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Wrench className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">No tools available</p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto flex-1 border-r dark:border-zinc-700 overscroll-contain">
      {tools.map((tool, index) => (
        <button
          key={tool.name}
          id={`tool-${tool.name}`}
          type="button"
          onClick={() => onToolSelect(tool)}
          className={cn(
            'w-full text-left cursor-pointer p-4 border-b dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors group',
            selectedTool?.name === tool.name
            && 'bg-blue-50 dark:bg-zinc-800 border-l-4 border-l-blue-500',
            focusedIndex === index
            && 'ring-2 ring-blue-500 dark:ring-blue-400 ring-inset',
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <div
                className={cn(
                  'p-3 rounded-full transition-colors',
                  selectedTool?.name === tool.name
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    : 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-gray-400 group-hover:bg-gray-200 dark:group-hover:bg-zinc-600',
                )}
              >
                <Wrench className="h-4 w-4" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3
                  className={cn(
                    'font-medium truncate',
                    selectedTool?.name === tool.name
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-gray-900 dark:text-gray-100',
                  )}
                >
                  {tool.name}
                </h3>
                {tool.inputSchema?.properties && (
                  <Badge
                    variant="outline"
                    className="text-xs border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-gray-400"
                  >
                    {Object.keys(tool.inputSchema.properties).length}
                    {' '}
                    params
                  </Badge>
                )}
              </div>
              {tool.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                  {tool.description}
                </p>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
