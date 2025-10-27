import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Spinner } from '@/client/components/ui/spinner'
import { TooltipProvider } from '@/client/components/ui/tooltip'
import { useInspector } from '@/client/context/InspectorContext'
import { useMcpContext } from '@/client/context/McpContext'
import { useAutoConnect } from '@/client/hooks/useAutoConnect'
import { useKeyboardShortcuts } from '@/client/hooks/useKeyboardShortcuts'
import { useSavedRequests } from '@/client/hooks/useSavedRequests'
import { MCPCommandPaletteOpenEvent, Telemetry } from '@/client/telemetry'
import { CommandPalette } from './CommandPalette'
import { LayoutContent } from './LayoutContent'
import { LayoutHeader } from './LayoutHeader'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { connections, addConnection, removeConnection } = useMcpContext()
  const {
    selectedServerId,
    setSelectedServerId,
    activeTab,
    setActiveTab,
    navigateToItem,
    setTunnelUrl,
  } = useInspector()

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const savedRequests = useSavedRequests()
  
  // Read tunnelUrl from query parameters and store in context
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search)
    const tunnelUrl = urlParams.get('tunnelUrl')
    setTunnelUrl(tunnelUrl)
  }, [location.search, setTunnelUrl])

  // Refs for search inputs in tabs
  const toolsSearchRef = useRef<{
    focusSearch: () => void
    blurSearch: () => void
  } | null>(null)
  const promptsSearchRef = useRef<{
    focusSearch: () => void
    blurSearch: () => void
  } | null>(null)
  const resourcesSearchRef = useRef<{
    focusSearch: () => void
    blurSearch: () => void
  } | null>(null)

  // Auto-connect handling extracted to custom hook
  const { isAutoConnecting } = useAutoConnect({
    connections,
    addConnection,
    removeConnection,
  })

  // Track command palette open
  const handleCommandPaletteOpen = useCallback(
    (trigger: 'keyboard' | 'button') => {
      const telemetry = Telemetry.getInstance()
      telemetry
        .capture(
          new MCPCommandPaletteOpenEvent({
            trigger,
          }),
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        })
      setIsCommandPaletteOpen(true)
    },
    [],
  )

  const handleServerSelect = (serverId: string) => {
    const server = connections.find(c => c.id === serverId)
    if (!server || server.state !== 'ready') {
      toast.error('Server is not connected and cannot be inspected')
      return
    }
    setSelectedServerId(serverId)
    // Preserve tunnelUrl parameter if present
    const urlParams = new URLSearchParams(location.search)
    const tunnelUrl = urlParams.get('tunnelUrl')
    const newUrl = tunnelUrl
      ? `/?server=${encodeURIComponent(serverId)}&tunnelUrl=${encodeURIComponent(tunnelUrl)}`
      : `/?server=${encodeURIComponent(serverId)}`
    navigate(newUrl)
  }

  const handleCommandPaletteNavigate = (
    tab: 'tools' | 'prompts' | 'resources',
    itemName?: string,
    serverId?: string,
  ) => {
    console.warn('[Layout] handleCommandPaletteNavigate called:', {
      tab,
      itemName,
      serverId,
    })

    // If a serverId is provided, navigate to that server
    if (serverId) {
      const server = connections.find(c => c.id === serverId)
      console.warn('[Layout] Server lookup:', {
        serverId,
        serverFound: !!server,
        serverState: server?.state,
      })

      if (!server || server.state !== 'ready') {
        console.warn('[Layout] Server not ready, showing error')
        toast.error('Server is not connected and cannot be inspected')
        return
      }

      console.warn('[Layout] Calling navigateToItem:', {
        serverId,
        tab,
        itemName,
      })
      // Use the context's navigateToItem to set all state atomically
      navigateToItem(serverId, tab, itemName)
      // Navigate using query params
      // Preserve tunnelUrl parameter if present
      const urlParams = new URLSearchParams(location.search)
      const tunnelUrl = urlParams.get('tunnelUrl')
      const newUrl = tunnelUrl
        ? `/?server=${encodeURIComponent(serverId)}&tunnelUrl=${encodeURIComponent(tunnelUrl)}`
        : `/?server=${encodeURIComponent(serverId)}`
      console.warn('[Layout] Navigating to:', newUrl)
      navigate(newUrl)
    }
    else {
      console.warn('[Layout] No serverId, just updating tab to:', tab)
      // No serverId provided, just update the tab for the current server
      setActiveTab(tab)
    }
  }

  const selectedServer = connections.find(c => c.id === selectedServerId)

  // Aggregate tools, prompts, and resources from all connected servers
  // When a server is selected, use only that server's items
  // When no server is selected, aggregate from all ready servers and add server metadata
  const aggregatedTools = selectedServer
    ? selectedServer.tools.map(tool => ({
        ...tool,
        _serverId: selectedServer.id,
      }))
    : connections.flatMap(conn =>
        conn.state === 'ready'
          ? conn.tools.map(tool => ({
              ...tool,
              _serverId: conn.id,
              _serverName: conn.name,
            }))
          : [],
      )

  const aggregatedPrompts = selectedServer
    ? selectedServer.prompts.map(prompt => ({
        ...prompt,
        _serverId: selectedServer.id,
      }))
    : connections.flatMap(conn =>
        conn.state === 'ready'
          ? conn.prompts.map(prompt => ({
              ...prompt,
              _serverId: conn.id,
              _serverName: conn.name,
            }))
          : [],
      )

  const aggregatedResources = selectedServer
    ? selectedServer.resources.map(resource => ({
        ...resource,
        _serverId: selectedServer.id,
      }))
    : connections.flatMap(conn =>
        conn.state === 'ready'
          ? conn.resources.map(resource => ({
              ...resource,
              _serverId: conn.id,
              _serverName: conn.name,
            }))
          : [],
      )

  // Sync URL query params with selected server state
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const serverParam = searchParams.get('server')
    const decodedServerId = serverParam ? decodeURIComponent(serverParam) : null

    // Update selected server if changed
    if (decodedServerId !== selectedServerId) {
      setSelectedServerId(decodedServerId)
    }
  }, [location.search, selectedServerId, setSelectedServerId])

  // Handle failed server connections - redirect to home
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const serverParam = searchParams.get('server')
    if (!serverParam) {
      return
    }

    const decodedServerId = decodeURIComponent(serverParam)
    const serverConnection = connections.find(
      conn => conn.id === decodedServerId,
    )

    // No connection found - wait for auto-connect, then redirect
    if (!serverConnection) {
      const timeoutId = setTimeout(() => navigate('/'), 3000)
      return () => clearTimeout(timeoutId)
    }

    // Connection failed - redirect after short delay
    if (serverConnection.state === 'failed') {
      const timeoutId = setTimeout(() => navigate('/'), 2000)
      return () => clearTimeout(timeoutId)
    }
  }, [location.search, navigate, connections])

  // Centralized keyboard shortcuts
  useKeyboardShortcuts({
    onCommandPalette: () => handleCommandPaletteOpen('keyboard'),
    onToolsTab: () => {
      if (selectedServer) {
        setActiveTab('tools')
      }
    },
    onPromptsTab: () => {
      if (selectedServer) {
        setActiveTab('prompts')
      }
    },
    onResourcesTab: () => {
      if (selectedServer) {
        setActiveTab('resources')
      }
    },
    onChatTab: () => {
      if (selectedServer) {
        setActiveTab('chat')
      }
    },
    onHome: () => {
      navigate('/')
    },
    onFocusSearch: () => {
      // Focus the search bar based on the active tab
      if (activeTab === 'tools' && toolsSearchRef.current) {
        toolsSearchRef.current.focusSearch()
      }
      else if (activeTab === 'prompts' && promptsSearchRef.current) {
        promptsSearchRef.current.focusSearch()
      }
      else if (activeTab === 'resources' && resourcesSearchRef.current) {
        resourcesSearchRef.current.focusSearch()
      }
    },
    onBlurSearch: () => {
      // Blur the search bar based on the active tab
      if (activeTab === 'tools' && toolsSearchRef.current) {
        toolsSearchRef.current.blurSearch()
      }
      else if (activeTab === 'prompts' && promptsSearchRef.current) {
        promptsSearchRef.current.blurSearch()
      }
      else if (activeTab === 'resources' && resourcesSearchRef.current) {
        resourcesSearchRef.current.blurSearch()
      }
    },
  })

  // Show loading spinner during auto-connection
  if (isAutoConnecting) {
    return (
      <div className="h-screen bg-white dark:bg-zinc-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-8 w-8 text-zinc-600 dark:text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connecting to MCP server...
          </p>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="h-screen bg-[#f3f3f3] dark:bg-black flex flex-col px-4 py-4 gap-4">
        {/* Header */}
        <LayoutHeader
          connections={connections}
          selectedServer={selectedServer}
          activeTab={activeTab}
          onServerSelect={handleServerSelect}
          onTabChange={setActiveTab}
          onCommandPaletteOpen={() => handleCommandPaletteOpen('button')}
          onOpenConnectionOptions={() => {}}
        />

        {/* Main Content */}
        <main className="flex-1 w-full mx-auto bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-zinc-700 p-0 overflow-auto">
          <LayoutContent
            selectedServer={selectedServer}
            activeTab={activeTab}
            toolsSearchRef={toolsSearchRef}
            promptsSearchRef={promptsSearchRef}
            resourcesSearchRef={resourcesSearchRef}
          >
            {children}
          </LayoutContent>
        </main>

        {/* Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onOpenChange={setIsCommandPaletteOpen}
          tools={aggregatedTools}
          prompts={aggregatedPrompts}
          resources={aggregatedResources}
          savedRequests={savedRequests}
          connections={connections}
          onNavigate={handleCommandPaletteNavigate}
          onServerSelect={handleServerSelect}
        />

        {/* Connection Options Dialog */}
      </div>
    </TooltipProvider>
  )
}
