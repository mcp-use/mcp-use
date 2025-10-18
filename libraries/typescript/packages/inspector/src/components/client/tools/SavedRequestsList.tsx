import { Clock, Database, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SavedRequest {
  id: string
  name: string
  toolName: string
  args: Record<string, unknown>
  savedAt: number
}

interface SavedRequestsListProps {
  savedRequests: SavedRequest[]
  onLoadRequest: (request: SavedRequest) => void
  onDeleteRequest: (id: string) => void
  focusedIndex: number
}

export function SavedRequestsList({
  savedRequests,
  onLoadRequest,
  onDeleteRequest,
  focusedIndex,
}: SavedRequestsListProps) {
  if (savedRequests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Database className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          No saved requests yet
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Execute a tool and click Save to store requests
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto h-full border-r dark:border-zinc-700">
      {savedRequests.map((request, index) => (
        <div
          key={request.id}
          id={`saved-${request.id}`}
          className={cn(
            'p-4 border-b dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors group',
            focusedIndex === index
            && 'ring-2 ring-purple-500 dark:ring-purple-400 ring-inset',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => onLoadRequest(request)}
              className="flex-1 text-left min-w-0"
            >
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {request.name}
                </h3>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {request.toolName}
              </p>
              <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <Clock className="h-3 w-3" />
                {new Date(request.savedAt).toLocaleString()}
              </div>
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeleteRequest(request.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
