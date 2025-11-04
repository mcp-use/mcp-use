import type { ReactNode, RefObject } from 'react'
import type { MCPConnection } from '@/client/context/McpContext'
import { ChatTab } from './ChatTab'
import { PromptsTab } from './PromptsTab'
import { ResourcesTab } from './ResourcesTab'
import { ToolsTab } from './ToolsTab'

interface LayoutContentProps {
  selectedServer: MCPConnection | undefined
  activeTab: string
  toolsSearchRef: RefObject<{
    focusSearch: () => void
    blurSearch: () => void
  } | null>
  promptsSearchRef: RefObject<{
    focusSearch: () => void
    blurSearch: () => void
  } | null>
  resourcesSearchRef: RefObject<{
    focusSearch: () => void
    blurSearch: () => void
  } | null>
  children: ReactNode
}

export function LayoutContent({
  selectedServer,
  activeTab,
  toolsSearchRef,
  promptsSearchRef,
  resourcesSearchRef,
  children,
}: LayoutContentProps) {
  if (!selectedServer) {
    return <>{children}</>
  }

  switch (activeTab) {
    case 'tools':
      return (
        <ToolsTab
          ref={toolsSearchRef}
          tools={selectedServer.tools}
          callTool={selectedServer.callTool}
          readResource={selectedServer.readResource}
          serverId={selectedServer.id}
          isConnected={selectedServer.state === 'ready'}
        />
      )
    case 'prompts':
      return (
        <PromptsTab
          ref={promptsSearchRef}
          prompts={selectedServer.prompts}
          callPrompt={selectedServer.getPrompt}
          serverId={selectedServer.id}
          isConnected={selectedServer.state === 'ready'}
        />
      )
    case 'resources':
      return (
        <ResourcesTab
          ref={resourcesSearchRef}
          resources={selectedServer.resources}
          readResource={selectedServer.readResource}
          serverId={selectedServer.id}
          isConnected={selectedServer.state === 'ready'}
        />
      )
    case 'chat':
      return (
        <ChatTab
          key={selectedServer.id}
          connection={selectedServer}
          isConnected={selectedServer.state === 'ready'}
          readResource={selectedServer.readResource}
        />
      )
    default:
      return <>{children}</>
  }
}
