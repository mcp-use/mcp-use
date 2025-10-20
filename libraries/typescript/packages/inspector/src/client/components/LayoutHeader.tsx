import type { TabType } from '@/client/context/InspectorContext'
import type { MCPConnection } from '@/client/context/McpContext'
import { Command, FolderOpen, MessageCircle, MessageSquare, Wrench } from 'lucide-react'
import { Button } from '@/client/components/ui/button'
import { DiscordIcon } from '@/client/components/ui/discord-icon'
import { Tabs, TabsList, TabsTrigger } from '@/client/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/client/components/ui/tooltip'
import { cn } from '@/client/lib/utils'
import { AnimatedThemeToggler } from './AnimatedThemeToggler'
import LogoAnimated from './LogoAnimated'
import { ServerDropdown } from './ServerDropdown'

interface LayoutHeaderProps {
  connections: MCPConnection[]
  selectedServer: MCPConnection | undefined
  activeTab: string
  onServerSelect: (serverId: string) => void
  onTabChange: (tab: TabType) => void
  onCommandPaletteOpen: () => void
  onOpenConnectionOptions: (connectionId: string | null) => void
}

const tabs = [
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'prompts', label: 'Prompts', icon: MessageSquare },
  { id: 'resources', label: 'Resources', icon: FolderOpen },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
]

export function LayoutHeader({
  connections,
  selectedServer,
  activeTab,
  onServerSelect,
  onTabChange,
  onCommandPaletteOpen,
  onOpenConnectionOptions,
}: LayoutHeaderProps) {
  return (
    <header className="w-full mx-auto">
      <div className="flex items-center justify-between">
        {/* Left side: Server dropdown + Tabs */}
        <div className="flex items-center space-x-6">
          {/* Server Selection Dropdown */}
          <ServerDropdown
            connections={connections}
            selectedServer={selectedServer}
            onServerSelect={onServerSelect}
            onOpenConnectionOptions={onOpenConnectionOptions}
          />

          {/* Tabs */}
          {selectedServer && (
            <Tabs value={activeTab} onValueChange={tab => onTabChange(tab as TabType)}>
              <TabsList>
                {tabs.map((tab) => {
                  // Get count for the current tab
                  let count = 0
                  if (tab.id === 'tools') {
                    count = selectedServer.tools.length
                  }
                  else if (tab.id === 'prompts') {
                    count = selectedServer.prompts.length
                  }
                  else if (tab.id === 'resources') {
                    count = selectedServer.resources.length
                  }

                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      icon={tab.icon}
                      className="[&>svg]:mr-0 lg:[&>svg]:mr-2"
                    >
                      <div className="items-center gap-2 hidden lg:flex">
                        {tab.label}
                        {count > 0 && (
                          <span className={
                            cn(activeTab === tab.id ? ' dark:bg-black ' : 'dark:bg-zinc-700', 'bg-zinc-200 text-zinc-700 dark:text-zinc-300 text-xs px-2 py-0.5 rounded-full font-medium')
                          }
                          >
                            {count}
                          </span>
                        )}
                      </div>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
          )}
        </div>

        {/* Right side: Theme Toggle + Command Palette + Discord Button + Logo */}
        <div className="flex items-center gap-4">
          <Tooltip>
            <TooltipTrigger>
              <AnimatedThemeToggler className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors cursor-pointer" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle theme</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full px-1 -mx-3 flex gap-1"
                onClick={onCommandPaletteOpen}
              >
                <Command className="size-4" />
                <span className="text-base font-mono">K</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Command Palette</p>
            </TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" asChild>
            <a
              href="https://discord.gg/XkNkSkMz3V"
              className="flex items-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <DiscordIcon className="h-4 w-4" />
              Discord
            </a>
          </Button>

          <LogoAnimated state="expanded" />
        </div>
      </div>
    </header>
  )
}
