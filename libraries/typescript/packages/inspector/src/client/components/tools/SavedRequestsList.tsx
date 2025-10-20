import { Database, History, Trash2 } from 'lucide-react'
import { ListItem } from '@/client/components/shared'
import { Button } from '@/client/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/client/components/ui/tooltip'

export interface SavedRequest {
  id: string
  name: string
  toolName: string
  args: Record<string, unknown>
  savedAt: number
  serverId?: string
  serverName?: string
}

interface SavedRequestsListProps {
  savedRequests: SavedRequest[]
  selectedRequest: SavedRequest | null
  onLoadRequest: (request: SavedRequest) => void
  onDeleteRequest: (id: string) => void
  focusedIndex: number
}

export function SavedRequestsList({
  savedRequests,
  selectedRequest,
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

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation()
    action()
  }

  return (
    <div className="overflow-y-auto flex-1 border-r dark:border-zinc-700 overscroll-contain">
      {savedRequests.map((request, index) => (
        <div key={request.id} className="relative group">
          <ListItem
            id={`saved-${request.id}`}
            isSelected={selectedRequest?.id === request.id}
            isFocused={focusedIndex === index}
            icon={<History className="h-4 w-4" />}
            title={request.name}
            description={request.toolName}
            metadata={
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(request.savedAt).toLocaleString()}
                </span>
              </div>
            }
            onClick={() => onLoadRequest(request)}
          />
          <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={e => handleActionClick(e, () => onDeleteRequest(request.id))}
                  className="h-8 w-8 p-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Delete saved request</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      ))}
    </div>
  )
}
