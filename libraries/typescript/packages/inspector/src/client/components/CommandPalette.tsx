import type { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js'
import { Command } from 'cmdk'
import {
  ExternalLink,
  FileText,
  MessageSquare,
  Search,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { McpUseLogo } from './McpUseLogo'
import { ServerIcon } from './ServerIcon'

// Discord Icon Component
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 -28.5 256 256"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z"
        fillRule="nonzero"
      />
    </svg>
  )
}

interface CommandPaletteProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  tools: Tool[]
  prompts: Prompt[]
  resources: Resource[]
  connections: any[]
  onNavigate: (
    tab: 'tools' | 'prompts' | 'resources',
    itemName?: string,
    serverId?: string
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
          '_blank',
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
      category: (tool as any)._serverName
        ? `Tools - ${(tool as any)._serverName}`
        : 'Tools',
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
      category: (prompt as any)._serverName
        ? `Prompts - ${(prompt as any)._serverName}`
        : 'Prompts',
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
      console.warn('[CommandPalette] Item selected:', {
        itemType: item.type,
        itemName: item.name,
        itemId: item.id,
        metadata: item.metadata,
      })

      if (item.action) {
        console.warn('[CommandPalette] Executing action for global item')
        item.action()
        onOpenChange(false)
      }
      else if (item.type === 'global') {
        // Handle server selection
        if (item.metadata?.serverId) {
          console.warn(
            '[CommandPalette] Selecting server:',
            item.metadata.serverId,
          )
          onServerSelect(item.metadata.serverId)
          onOpenChange(false)
        }
      }
      else {
        // Navigate to the item's tab and server in one atomic operation
        // For resources, use URI instead of name
        const itemIdentifier
          = item.type === 'resource' ? item.metadata?.uri : item.name

        // Convert singular type to plural tab name
        const tabName
          = item.type === 'tool'
            ? 'tools'
            : item.type === 'prompt'
              ? 'prompts'
              : ('resources' as const)

        console.warn('[CommandPalette] Navigating to item:', {
          tab: tabName,
          itemIdentifier,
          serverId: item.metadata?.serverId,
        })
        onNavigate(tabName, itemIdentifier, item.metadata?.serverId)
        onOpenChange(false)
      }
    },
    [onNavigate, onOpenChange, onServerSelect],
  )

  const getIcon = (type: string, category?: string, itemName?: string) => {
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
          // Use MCP Use logo for MCP Use related documentation items
          if (itemName?.includes('MCP Use') || itemName?.includes('mcp-use')) {
            return (
              <div className="bg-black/10 dark:bg-white/10 rounded-full p-2 flex items-center justify-center shrink-0">
                <McpUseLogo
                  className="h-4 w-4 text-black dark:text-white"
                  size="sm"
                />
              </div>
            )
          }
          return (
            <div className="bg-orange-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
              <ExternalLink className="h-4 w-4 text-orange-500" />
            </div>
          )
        }
        if (category === 'Community') {
          return (
            <div className="bg-purple-500/20 rounded-full p-2 flex items-center justify-center shrink-0">
              <DiscordIcon className="h-4 w-4 text-purple-500" />
            </div>
          )
        }
        if (category === 'Connected Servers') {
          return (
            <div className="bg-cyan-500/20 rounded-full p-0 flex items-center justify-center shrink-0">
              <ServerIcon
                serverUrl={itemName}
                serverName={itemName}
                size="md"
              />
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
  }, [isOpen, setSearch])

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
      overlayClassName="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
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
        {commandItems.map(item => (
          <Command.Item
            key={item.id}
            value={`${item.name} ${item.description || ''} ${item.category}`}
            onSelect={() => handleSelect(item)}
            className="[content-visibility:auto] cursor-pointer h-12 rounded-lg text-sm flex items-center gap-3 px-4 text-foreground select-none will-change-[background,color] transition-all duration-150 data-[selected=true]:bg-accent data-[selected=true]:text-foreground data-[disabled=true]:text-muted-foreground/50 data-[disabled=true]:cursor-not-allowed active:bg-accent/80 mt-1 first:mt-0"
          >
            {getIcon(item.type, item.category, item.name)}
            <span className="font-medium truncate flex-1 min-w-0">
              {item.name}
            </span>
            {(item.metadata?.serverName || item.metadata?.serverId)
              && item.category !== 'Connected Servers' && (
              <div className="flex items-center gap-1.5 px-1 pr-2 py-1 rounded-full bg-zinc-200 dark:bg-zinc-800 shrink-0">
                <ServerIcon
                  serverUrl={item.metadata?.serverId}
                  serverName={item.metadata?.serverName}
                  size="sm"
                />
                <span className="text-xs font-base text-muted-foreground">
                  {item.metadata?.serverName || item.metadata?.serverId}
                </span>
              </div>
            )}
          </Command.Item>
        ))}
      </Command.List>

      {/* Keyboard Shortcuts Footer */}
      <div className="border-t border-border px-4 py-3 pb-1 flex items-center justify-between text-xs text-muted-foreground ">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 font-mono font-medium rounded shadow-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-foreground leading-none">
              t
            </span>
            <span>Tools</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 font-mono font-medium rounded shadow-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-foreground leading-none">
              p
            </span>
            <span>Prompts</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 font-mono font-medium rounded shadow-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-foreground leading-none">
              r
            </span>
            <span>Resources</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 font-mono font-medium rounded shadow-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-foreground leading-none">
              c
            </span>
            <span>Chat</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 font-mono font-medium rounded shadow-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-foreground leading-none">
              h
            </span>
            <span>Home</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center px-2 h-5 font-mono text-[10px] font-medium rounded shadow-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-foreground leading-none">
              esc
            </span>
            <span>Close</span>
          </div>
        </div>
      </div>
    </Command.Dialog>
  )
}
