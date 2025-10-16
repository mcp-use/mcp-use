import type { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js'
import { Command } from 'cmdk'
import {
  ExternalLink,
  FileText,
  MessageSquare,
  Search,
  Server,
  Users,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ServerIcon } from './ServerIcon'

interface CommandPaletteProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  tools: Tool[]
  prompts: Prompt[]
  resources: Resource[]
  connections: any[]
  onNavigate: (
    tab: 'tools' | 'prompts' | 'resources',
    itemName?: string
  ) => void
  onServerSelect: (serverId: string) => void
}

interface CommandItem {
  id: string
  name: string
  description?: string
  type: 'tool' | 'prompt' | 'resource' | 'global'
  category: string
  metadata?: any
  action?: () => void
}

export function CommandPalette({
  isOpen,
  onOpenChange,
  tools,
  prompts,
  resources,
  connections,
  onNavigate,
  onServerSelect,
}: CommandPaletteProps) {
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Create global command items
  const globalItems: CommandItem[] = [
    {
      id: 'mcp-docs',
      name: 'MCP Official Documentation',
      description: 'Learn about the Model Context Protocol',
      type: 'global',
      category: 'Documentation',
      action: () =>
        window.open(
          'https://modelcontextprotocol.io/docs/getting-started/intro',
          '_blank'
        ),
    },
    {
      id: 'mcp-use-website',
      name: 'MCP Use Website',
      description: 'Visit mcp-use.com for tools and resources',
      type: 'global',
      category: 'Documentation',
      action: () => window.open('https://mcp-use.com', '_blank'),
    },
    {
      id: 'mcp-use-docs',
      name: 'How to Create an MCP Server',
      description: 'Step-by-step guide to building MCP servers',
      type: 'global',
      category: 'Documentation',
      action: () => window.open('https://docs.mcp-use.com', '_blank'),
    },
    {
      id: 'discord',
      name: 'Join Discord Community',
      description: 'Connect with the MCP community',
      type: 'global',
      category: 'Community',
      action: () => window.open('https://discord.gg/XkNkSkMz3V', '_blank'),
    },
  ]

  // Create server selection items
  const serverItems: CommandItem[] = connections.map((connection) => ({
    id: `server-${connection.id}`,
    name: connection.name,
    description: `Connected server (${connection.state})`,
    type: 'global',
    category: 'Connected Servers',
    metadata: { serverId: connection.id, state: connection.state },
    action: () => onServerSelect(connection.id),
  }))

  // Create unified command items
  const commandItems: CommandItem[] = [
    ...globalItems,
    ...serverItems,
    ...tools.map((tool) => ({
      id: `tool-${tool.name}`,
      name: tool.name,
      description: tool.description,
      type: 'tool' as const,
      category: (tool as any)._serverName
        ? `Tools - ${(tool as any)._serverName}`
        : 'Tools',
      metadata: {
        inputSchema: tool.inputSchema,
        serverId: (tool as any)._serverId,
        serverName: (tool as any)._serverName,
      },
    })),
    ...prompts.map((prompt) => ({
      id: `prompt-${prompt.name}`,
      name: prompt.name,
      description: prompt.description,
      type: 'prompt' as const,
      category: (prompt as any)._serverName
        ? `Prompts - ${(prompt as any)._serverName}`
        : 'Prompts',
      metadata: {
        arguments: prompt.arguments,
        serverId: (prompt as any)._serverId,
        serverName: (prompt as any)._serverName,
      },
    })),
    ...resources.map((resource) => ({
      id: `resource-${resource.uri}`,
      name: resource.name,
      description: resource.description,
      type: 'resource' as const,
      category: (resource as any)._serverName
        ? `Resources - ${(resource as any)._serverName}`
        : 'Resources',
      metadata: {
        uri: resource.uri,
        mimeType: resource.mimeType,
        serverId: (resource as any)._serverId,
        serverName: (resource as any)._serverName,
      },
    })),
  ]

  const handleSelect = useCallback(
    (item: CommandItem) => {
      if (item.action) {
        item.action()
        onOpenChange(false)
      } else if (item.type === 'global') {
        // Handle server selection
        if (item.metadata?.serverId) {
          onServerSelect(item.metadata.serverId)
          onOpenChange(false)
        }
      } else {
        // If the item belongs to a specific server, switch to that server first
        if (item.metadata?.serverId) {
          onServerSelect(item.metadata.serverId)
        }
        onNavigate(item.type as 'tools' | 'prompts' | 'resources', item.name)
        onOpenChange(false)
      }
    },
    [onNavigate, onOpenChange, onServerSelect]
  )

  const getIcon = (type: string, category?: string) => {
    switch (type) {
      case 'tool':
        return (
          <div className="bg-blue-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
            <Wrench className="h-4 w-4 text-blue-500" />
          </div>
        )
      case 'prompt':
        return (
          <div className="bg-purple-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
            <MessageSquare className="h-4 w-4 text-purple-500" />
          </div>
        )
      case 'resource':
        return (
          <div className="bg-green-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
            <FileText className="h-4 w-4 text-green-500" />
          </div>
        )
      case 'global':
        if (category === 'Documentation') {
          return (
            <div className="bg-orange-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
              <ExternalLink className="h-4 w-4 text-orange-500" />
            </div>
          )
        }
        if (category === 'Community') {
          return (
            <div className="bg-pink-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-pink-500" />
            </div>
          )
        }
        if (category === 'Connected Servers') {
          return (
            <div className="bg-cyan-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
              <Server className="h-4 w-4 text-cyan-500" />
            </div>
          )
        }
        return (
          <div className="bg-gray-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
            <ExternalLink className="h-4 w-4 text-gray-500" />
          </div>
        )
      default:
        return (
          <div className="bg-gray-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
            <Search className="h-4 w-4 text-gray-500" />
          </div>
        )
    }
  }

  // Reset search when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearch('')
    }
  }, [isOpen])

  // Scroll to top when search changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [search])

  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={onOpenChange}
      label="Command Palette"
      className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[51] max-w-[640px] w-full p-2 bg-white dark:bg-zinc-900/90 backdrop-blur-xl rounded-xl overflow-hidden border border-border shadow-[var(--cmdk-shadow)] transition-transform duration-100 ease-out outline-none max-sm:max-w-full"
      overlayClassName="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
    >
      <Command.Input
        placeholder="What do you need?"
        value={search}
        onValueChange={setSearch}
        className="border-none w-full text-[17px] px-4 pt-2 pb-4 outline-none bg-transparent text-foreground border-b border-border mb-0 rounded-none placeholder:text-muted-foreground"
      />
      <Command.List
        ref={listRef}
        className="min-h-[330px] max-h-[400px] overflow-auto overscroll-contain transition-[height] duration-100 ease-out"
      >
        <Command.Empty className="text-sm flex items-center justify-center h-12 whitespace-pre-wrap text-muted-foreground">
          No results found.
        </Command.Empty>
        {commandItems.map((item) => (
          <Command.Item
            key={item.id}
            value={`${item.name} ${item.description || ''} ${item.category}`}
            onSelect={() => handleSelect(item)}
            className="[content-visibility:auto] cursor-pointer h-12 rounded-lg text-sm flex items-center gap-3 px-4 text-foreground select-none will-change-[background,color] transition-all duration-150 data-[selected=true]:bg-accent data-[selected=true]:text-foreground data-[disabled=true]:text-muted-foreground/50 data-[disabled=true]:cursor-not-allowed active:bg-accent/80 mt-1 first:mt-0"
          >
            {getIcon(item.type, item.category)}
            <span className="font-medium truncate flex-1 min-w-0">
              {item.name}
            </span>
            {(item.metadata?.serverName || item.metadata?.serverId) && (
              <div className="flex items-center gap-1.5 px-1 pr-2 py-1 rounded-full bg-zinc-200 dark:bg-zinc-800 shrink-0">
                <ServerIcon
                  serverUrl={item.metadata?.serverId}
                  serverName={item.metadata?.serverName}
                  size="xs"
                />
                <span className="text-xs font-base text-muted-foreground">
                  {item.metadata?.serverName || item.metadata?.serverId}
                </span>
              </div>
            )}
          </Command.Item>
        ))}
      </Command.List>
    </Command.Dialog>
  )
}
