import type { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js'
import { Command } from 'cmdk'
import { ExternalLink, FileText, MessageSquare, Search, Server, Users, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'

interface CommandPaletteProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  tools: Tool[]
  prompts: Prompt[]
  resources: Resource[]
  connections: any[]
  onNavigate: (tab: 'tools' | 'prompts' | 'resources', itemName?: string) => void
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

  // Create global command items
  const globalItems: CommandItem[] = [
    {
      id: 'mcp-docs',
      name: 'MCP Official Documentation',
      description: 'Learn about the Model Context Protocol',
      type: 'global',
      category: 'Documentation',
      action: () => window.open('https://modelcontextprotocol.io/docs/getting-started/intro', '_blank'),
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
  const serverItems: CommandItem[] = connections.map(connection => ({
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
    ...tools.map(tool => ({
      id: `tool-${tool.name}`,
      name: tool.name,
      description: tool.description,
      type: 'tool' as const,
      category: (tool as any)._serverName ? `Tools - ${(tool as any)._serverName}` : 'Tools',
      metadata: {
        inputSchema: tool.inputSchema,
        serverId: (tool as any)._serverId,
        serverName: (tool as any)._serverName,
      },
    })),
    ...prompts.map(prompt => ({
      id: `prompt-${prompt.name}`,
      name: prompt.name,
      description: prompt.description,
      type: 'prompt' as const,
      category: (prompt as any)._serverName ? `Prompts - ${(prompt as any)._serverName}` : 'Prompts',
      metadata: {
        arguments: prompt.arguments,
        serverId: (prompt as any)._serverId,
        serverName: (prompt as any)._serverName,
      },
    })),
    ...resources.map(resource => ({
      id: `resource-${resource.uri}`,
      name: resource.name,
      description: resource.description,
      type: 'resource' as const,
      category: (resource as any)._serverName ? `Resources - ${(resource as any)._serverName}` : 'Resources',
      metadata: {
        uri: resource.uri,
        mimeType: resource.mimeType,
        serverId: (resource as any)._serverId,
        serverName: (resource as any)._serverName,
      },
    })),
  ]

  const handleSelect = useCallback((item: CommandItem) => {
    if (item.action) {
      item.action()
      onOpenChange(false)
    }
    else if (item.type === 'global') {
      // Handle server selection
      if (item.metadata?.serverId) {
        onServerSelect(item.metadata.serverId)
        onOpenChange(false)
      }
    }
    else {
      // If the item belongs to a specific server, switch to that server first
      if (item.metadata?.serverId) {
        onServerSelect(item.metadata.serverId)
      }
      onNavigate(item.type as 'tools' | 'prompts' | 'resources', item.name)
      onOpenChange(false)
    }
  }, [onNavigate, onOpenChange, onServerSelect])

  const getIcon = (type: string, category?: string) => {
    switch (type) {
      case 'tool':
        return <Wrench className="h-4 w-4" />
      case 'prompt':
        return <MessageSquare className="h-4 w-4" />
      case 'resource':
        return <FileText className="h-4 w-4" />
      case 'global':
        if (category === 'Documentation') {
          return <ExternalLink className="h-4 w-4" />
        }
        if (category === 'Community') {
          return <Users className="h-4 w-4" />
        }
        if (category === 'Connected Servers') {
          return <Server className="h-4 w-4" />
        }
        return <ExternalLink className="h-4 w-4" />
      default:
        return <Search className="h-4 w-4" />
    }
  }

  const getMetadataPreview = (item: CommandItem) => {
    if (item.type === 'tool' && item.metadata?.inputSchema?.properties) {
      const props = Object.keys(item.metadata.inputSchema.properties)
      return props.length > 0 ? `${props.length} parameter${props.length > 1 ? 's' : ''}` : 'No parameters'
    }
    if (item.type === 'prompt' && item.metadata?.arguments) {
      const args = Object.keys(item.metadata.arguments)
      return args.length > 0 ? `${args.length} argument${args.length > 1 ? 's' : ''}` : 'No arguments'
    }
    if (item.type === 'resource' && item.metadata?.mimeType) {
      return item.metadata.mimeType
    }
    if (item.type === 'global' && item.category === 'Connected Servers' && item.metadata?.state) {
      return item.metadata.state
    }
    return null
  }

  // Reset search when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearch('')
    }
  }, [isOpen])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] p-0">
        <Command className="rounded-lg shadow-md">
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input
              placeholder="Search tools, prompts, and resources..."
              value={search}
              onValueChange={setSearch}
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden">
            <Command.Empty className="py-6 text-center text-sm">
              No results found.
            </Command.Empty>
            {commandItems.map(item => (
              <Command.Item
                key={item.id}
                value={`${item.name} ${item.description || ''} ${item.category}`}
                onSelect={() => handleSelect(item)}
                className="flex cursor-pointer items-center space-x-2 rounded-md px-2 py-1.5 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  {getIcon(item.type, item.category)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium truncate">{item.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {item.category}
                      </Badge>
                    </div>
                    {item.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {item.description}
                      </p>
                    )}
                    {getMetadataPreview(item) && (
                      <p className="text-xs text-blue-600">
                        {getMetadataPreview(item)}
                      </p>
                    )}
                  </div>
                </div>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
