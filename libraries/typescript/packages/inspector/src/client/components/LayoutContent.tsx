import type { ReactNode, RefObject } from 'react'
import type { MCPConnection } from '@/client/context/McpContext'
import { ChatTab } from './ChatTab'
import { PromptsTab } from './PromptsTab'
import { ResourcesTab } from './ResourcesTab'
import { ToolsTab } from './ToolsTab'

interface LayoutContentProps {
  selectedServer: MCPConnection | undefined
  activeTab: string
  toolsSearchRef: RefObject<{ focusSearch: () => void, blurSearch: () => void } | null>
  promptsSearchRef: RefObject<{ focusSearch: () => void, blurSearch: () => void } | null>
  resourcesSearchRef: RefObject<{ focusSearch: () => void, blurSearch: () => void } | null>
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
          isConnected={selectedServer.state === 'ready'}
        />
      )
    case 'prompts':
      return (
        <PromptsTab
          ref={promptsSearchRef}
          prompts={selectedServer.prompts}
          callPrompt={selectedServer.callTool} // Using callTool for now, should be callPrompt when available
          isConnected={selectedServer.state === 'ready'}
        />
      )
    case 'resources':
      return (
        <ResourcesTab
          ref={resourcesSearchRef}
          resources={selectedServer.resources}
          readResource={selectedServer.readResource}
          isConnected={selectedServer.state === 'ready'}
        />
      )
    case 'chat':
      return (
        <ChatTab
          mcpServerUrl={selectedServer.url}
          isConnected={selectedServer.state === 'ready'}
          oauthState={selectedServer.state as 'pending_auth' | 'authenticating' | 'ready' | 'failed' | undefined}
          oauthError={selectedServer.error ?? undefined}
        />
      )
    default:
      return <>{children}</>
  }
}
