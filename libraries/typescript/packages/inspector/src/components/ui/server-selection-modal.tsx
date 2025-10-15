'use client'

import { Check, ChevronDown, Circle, Loader2, Plus, Search, Server } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../lib/utils'
import { AddServerDialog } from './add-server-dialog'
import { Badge } from './badge'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { PulsatingButton } from './pulsating-button'
import { RandomGradientBackground } from './random-gradient-background'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './tooltip'

interface ServerOption {
  id: string
  name: string
  color?: string
}

interface ServerSelectionModalProps {
  servers: ServerOption[]
  selectedServer: string
  onServerChange: (serverId: string) => void
  onServerAdded: (server: ServerOption) => void
  isInitializing?: boolean
}

export function ServerSelectionModal({
  servers,
  selectedServer,
  onServerChange,
  onServerAdded,
  isInitializing = false,
}: ServerSelectionModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const currentServer = servers.find(server => server.id === selectedServer)

  // Filter servers based on search query
  const filteredServers = servers.filter(
    server =>
      server.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            {!selectedServer
              ? (
                  <PulsatingButton className="rounded-full hover:bg-black/80 flex items-center gap-2 bg-black text-white text-sm" pulseColor="#d4d0cb" duration="3.5s">
                    <Server className="size-3.5" />
                    Select server
                  </PulsatingButton>
                )
              : isInitializing
                ? (
                    <div className="rounded-full border border-zinc-200 dark:border-zinc-700 p-1 cursor-not-allowed opacity-50">
                      <div className="flex items-center gap-2 px-3 py-1">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Connecting...</span>
                      </div>
                    </div>
                  )
                : (
                    <button className="rounded-full border border-border p-1  cursor-pointer dark:hover:bg-zinc-800 bg-white hover:border-primary/40 hover:shadow-[0_0_0_4px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_0_0_4px_rgba(255,255,255,0.1)] transition-all">
                      <div className="flex items-center gap-3 p-0 pr-3">
                        <div className="w-8 h-8 rounded-full overflow-hidden border border-border">
                          <RandomGradientBackground
                            className="w-full h-full"
                            color={currentServer?.color}
                          >
                            <div className="flex items-center justify-center w-full h-full">
                              <Circle className="size-6 text-white/90" />
                            </div>
                          </RandomGradientBackground>
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {currentServer?.name || 'Select Server'}
                        </span>
                        <ChevronDown className="size-4 translate-y-[1px]" />
                      </div>
                    </button>
                  )}
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Configure server</p>
        </TooltipContent>
      </Tooltip>

      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Select Server</DialogTitle>
          <DialogDescription>
            Choose the server you want to connect to.
          </DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search servers..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="overflow-y-auto max-h-[60vh] pr-2">
          {filteredServers.map((server, index) => {
            const isSelected = selectedServer === server.id
            return (
              <div key={server.id}>
                <button
                  onClick={() => {
                    onServerChange(server.id)
                    setIsOpen(false)
                  }}
                  className={cn(
                    'w-full p-3 transition-all duration-200 text-left group flex items-center gap-3',
                    'hover:bg-zinc-50 dark:hover:bg-zinc-800',
                    isSelected && 'bg-zinc-100 dark:bg-zinc-800',
                    'rounded-xl',
                  )}
                >
                  {/* Server preview (fully rounded) with random gradient background */}
                  <div className="w-10 h-10 rounded-full flex-shrink-0 overflow-hidden">
                    <RandomGradientBackground
                      color={server.color}
                      className="w-full h-full rounded-full"
                    >
                      <div className="w-full h-full flex items-center justify-center">
                        <Circle
                          className={cn(
                            'h-5 w-5',
                            isSelected ? 'text-white' : 'text-white/80',
                          )}
                        />
                      </div>
                    </RandomGradientBackground>
                  </div>

                  {/* Server name on the right */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {server.name}
                    </h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 truncate">
                      Server connection
                    </p>
                  </div>

                  {/* Selection indicator */}
                  <div className="flex-shrink-0 w-6 h-6 mr-3 flex items-center justify-center">
                    {isSelected
                      ? (
                          <Check className="h-4 w-4 text-black dark:text-white" />
                        )
                      : (
                          <div className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-600 group-hover:opacity-30 transition-opacity" />
                        )}
                  </div>
                </button>
                {/* Border separator between items */}
                {index < filteredServers.length - 1 && (
                  <div className="relative after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-[90%] after:h-px after:bg-zinc-100 dark:after:bg-zinc-800" />
                )}
              </div>
            )
          })}
        </div>

        {filteredServers.length === 0 && (
          <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
            <Circle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No servers available</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-between pt-4">
          <AddServerDialog onServerAdded={onServerAdded}>
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Server
            </Button>
          </AddServerDialog>

          <Button
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2"
          >
            Done
            {selectedServer && (
              <Badge
                variant="outline"
                className="text-xs text-white dark:text-black dark:border-zinc-700"
              >
                Connected
              </Badge>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
