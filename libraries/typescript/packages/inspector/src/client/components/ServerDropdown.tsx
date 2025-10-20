import type { MCPConnection } from '@/client/context/McpContext'
import { Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/client/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/client/components/ui/dropdown-menu'
import { ShimmerButton } from '@/client/components/ui/shimmer-button'
import { StatusDot } from '@/client/components/ui/status-dot'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/client/components/ui/tooltip'
import { cn } from '@/client/lib/utils'
import { ServerIcon } from './ServerIcon'

interface ServerDropdownProps {
  connections: MCPConnection[]
  selectedServer: MCPConnection | undefined
  onServerSelect: (serverId: string) => void
  onOpenConnectionOptions: (connectionId: string | null) => void
}

export function ServerDropdown({
  connections,
  selectedServer,
  onServerSelect,
  onOpenConnectionOptions,
}: ServerDropdownProps) {
  const navigate = useNavigate()

  const handleServerSelect = (serverId: string) => {
    const server = connections.find(c => c.id === serverId)
    if (!server || server.state !== 'ready') {
      toast.error('Server is not connected and cannot be inspected')
      return
    }
    onServerSelect(serverId)
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ShimmerButton
            className={cn(
              'min-w-[200px] p-0 px-1 text-sm h-11 justify-start bg-black dark:bg-white text-white dark:text-black border-black dark:border-white hover:bg-gray-800 dark:hover:bg-zinc-100 hover:border-gray-800 dark:hover:border-zinc-200',
              !selectedServer && 'pl-4',
              selectedServer && 'pr-4',
            )}
          >
            {selectedServer && (
              <ServerIcon
                serverUrl={selectedServer.url}
                serverName={selectedServer.name}
                size="md"
                className="mr-2"
              />
            )}
            <div className="flex items-center gap-2 flex-1">
              <span className="truncate">
                {selectedServer
                  ? selectedServer.name
                  : 'Select server to inspect'}
              </span>
              {selectedServer && (
                <div className="flex items-center gap-2">
                  {selectedServer.error
                    && selectedServer.state !== 'ready' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                              // Handle copy error functionality if needed
                              }}
                              className="w-2 h-2 rounded-full bg-rose-500 animate-status-pulse-red hover:bg-rose-600 transition-colors"
                              title="Click to copy error message"
                              aria-label="Copy error message to clipboard"
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              {selectedServer.error}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <div
                          className={`w-2 h-2 rounded-full ${
                            selectedServer.state === 'ready'
                              ? 'bg-emerald-600 animate-status-pulse'
                              : selectedServer.state === 'failed'
                                ? 'bg-rose-600 animate-status-pulse-red'
                                : 'bg-yellow-500 animate-status-pulse-yellow'
                          }`}
                        />
                      )}
                </div>
              )}
            </div>
          </ShimmerButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[300px]" align="start">
          <DropdownMenuLabel
            className="cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => navigate('/')}
          >
            MCP Servers
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {connections.length === 0
            ? (
                <div className="px-2 py-4 text-sm text-muted-foreground dark:text-zinc-400 text-center">
                  No servers connected. Go to the dashboard to add one.
                </div>
              )
            : (
                connections.map(connection => (
                  <DropdownMenuItem
                    key={connection.id}
                    onClick={() => handleServerSelect(connection.id)}
                    className="flex items-center gap-3"
                  >
                    <ServerIcon
                      serverUrl={connection.url}
                      serverName={connection.name}
                      size="sm"
                    />
                    <div className="flex items-center gap-2 flex-1">
                      <div className="font-medium">{connection.name}</div>
                      <StatusDot status={connection.state} />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenConnectionOptions(connection.id)
                      }}
                    >
                      <Settings className="h-3 w-3" />
                    </Button>
                  </DropdownMenuItem>
                ))
              )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/')}>
            <span className="text-blue-600 dark:text-blue-400">
              + Add new server
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
