import type { ReactNode } from 'react'
import type { CustomHeader } from './CustomHeadersEditor'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Spinner } from '@/client/components/ui/spinner'
import { TooltipProvider } from '@/client/components/ui/tooltip'
import { useInspector } from '@/client/context/InspectorContext'
import { useMcpContext } from '@/client/context/McpContext'
import { useKeyboardShortcuts } from '@/client/hooks/useKeyboardShortcuts'
import { CommandPalette } from './CommandPalette'
import { LayoutContent } from './LayoutContent'
import { LayoutHeader } from './LayoutHeader'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { connections, addConnection } = useMcpContext()
  const {
    selectedServerId,
    setSelectedServerId,
    activeTab,
    setActiveTab,
    navigateToItem,
  } = useInspector()
  const [configLoaded, setConfigLoaded] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isAutoConnecting, setIsAutoConnecting] = useState(false)

  // Connection options dialog state
  const [_connectionOptionsOpen, setConnectionOptionsOpen] = useState(false)
  const [_editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null,
  )

  // Refs for search inputs in tabs
  const toolsSearchRef = useRef<{ focusSearch: () => void, blurSearch: () => void } | null>(null)
  const promptsSearchRef = useRef<{ focusSearch: () => void, blurSearch: () => void } | null>(null)
  const resourcesSearchRef = useRef<{ focusSearch: () => void, blurSearch: () => void } | null>(null)

  // Form state for connection options
  const [_url, setUrl] = useState('')
  const [_connectionType, _setConnectionType] = useState('Direct')
  const [_customHeaders, setCustomHeaders] = useState<CustomHeader[]>([])
  const [_requestTimeout, _setRequestTimeout] = useState('10000')
  const [_resetTimeoutOnProgress, _setResetTimeoutOnProgress] = useState('True')
  const [_maxTotalTimeout, _setMaxTotalTimeout] = useState('60000')
  const [_proxyAddress, _setProxyAddress] = useState('')

  // OAuth fields
  const [_clientId, setClientId] = useState('')
  const [_redirectUrl, _setRedirectUrl] = useState(
    typeof window !== 'undefined'
      ? new URL('/inspector/oauth/callback', window.location.origin).toString()
      : 'http://localhost:3000/inspector/oauth/callback',
  )
  const [_scope, setScope] = useState('')

  const handleServerSelect = (serverId: string) => {
    const server = connections.find(c => c.id === serverId)
    if (!server || server.state !== 'ready') {
      toast.error('Server is not connected and cannot be inspected')
      return
    }
    setSelectedServerId(serverId)
    navigate(`/?server=${encodeURIComponent(serverId)}`)
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
      console.warn(
        '[Layout] Navigating to:',
        `/?server=${encodeURIComponent(serverId)}`,
      )
      navigate(`/?server=${encodeURIComponent(serverId)}`)
    }
    else {
      console.warn('[Layout] No serverId, just updating tab to:', tab)
      // No serverId provided, just update the tab for the current server
      setActiveTab(tab)
    }
  }

  const handleOpenConnectionOptions = (connectionId: string | null) => {
    setEditingConnectionId(connectionId)
    setConnectionOptionsOpen(true)

    // If editing an existing connection, populate the form with its data
    if (connectionId) {
      const connection = connections.find(c => c.id === connectionId)
      if (connection) {
        setUrl(connection.url)
        // Set other fields based on connection data if available
        // For now, we'll use defaults since the connection object might not have all the config
      }
    }
    else {
      // Reset form for new connection
      setUrl('')
      setCustomHeaders([])
      setClientId('')
      setScope('')
    }
  }

  const _handleSaveConnectionOptions = () => {
    // Here you would implement the logic to save/update the connection options
    // For now, we'll just close the dialog
    setConnectionOptionsOpen(false)
    setEditingConnectionId(null)
    toast.success('Connection options saved')
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

  // Load config and auto-connect if URL is provided
  useEffect(() => {
    if (configLoaded)
      return

    // Check for autoConnect query parameter first
    const urlParams = new URLSearchParams(window.location.search)
    const autoConnectUrl = urlParams.get('autoConnect')

    if (autoConnectUrl) {
      // Auto-connect to the URL from query parameter
      const existing = connections.find(c => c.url === autoConnectUrl)
      if (!existing) {
        setIsAutoConnecting(true)
        addConnection(autoConnectUrl, 'Local MCP Server', undefined, 'http')
        // Navigate immediately but keep loading screen visible a bit longer to avoid flash
        navigate(`/?server=${encodeURIComponent(autoConnectUrl)}`)
        const timeoutId = setTimeout(() => {
          setIsAutoConnecting(false)
        }, 1000)
        // Cleanup timeout on unmount
        return () => clearTimeout(timeoutId)
      }
      setConfigLoaded(true)
      return
    }

    // Fallback to config.json
    fetch('/inspector/config.json')
      .then(res => res.json())
      .then((config: { autoConnectUrl: string | null }) => {
        setConfigLoaded(true)
        if (config.autoConnectUrl) {
          // Check if we already have this server
          const existing = connections.find(
            c => c.url === config.autoConnectUrl,
          )
          if (!existing) {
            // Auto-connect to the local server
            addConnection(
              config.autoConnectUrl,
              'Local MCP Server',
              undefined,
              'http',
            )
          }
        }
      })
      .catch(() => {
        setConfigLoaded(true)
      })
  }, [configLoaded, connections, addConnection, navigate])

  // Handle navigation logic based on query parameters
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const serverParam = searchParams.get('server')

    if (serverParam) {
      // Decode the server ID from query param
      const decodedServerId = decodeURIComponent(serverParam)
      // Only update if different to avoid unnecessary re-renders
      if (decodedServerId !== selectedServerId) {
        setSelectedServerId(decodedServerId)
      }
    }
    else {
      // No server param, clear the selected server
      if (selectedServerId !== null) {
        setSelectedServerId(null)
      }
    }
  }, [location.search, selectedServerId, setSelectedServerId])

  // If server param exists but connection fails, navigate to root
  // But only after we've given connections time to load and establish
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const serverParam = searchParams.get('server')

    if (!serverParam || !configLoaded) {
      return
    }

    const decodedServerId = decodeURIComponent(serverParam)

    // Check if any connection exists for this server
    const serverConnection = connections.find(
      conn => conn.id === decodedServerId,
    )

    if (serverConnection) {
      // Server connection exists - check its state
      if (serverConnection.state === 'failed') {
        // Server failed to connect, redirect after a short delay
        const timeoutId = setTimeout(() => {
          navigate('/')
        }, 2000)
        return () => clearTimeout(timeoutId)
      }
      // If server is connecting/loading/discovering, don't redirect yet
      if (
        serverConnection.state === 'connecting'
        || serverConnection.state === 'loading'
        || serverConnection.state === 'discovering'
      ) {
        return
      }
      // If server is ready, we're good - no redirect needed
      return
    }

    // No connection found for this server
    // Wait a bit for auto-connection to potentially kick in, then redirect
    const timeoutId = setTimeout(() => {
      navigate('/')
    }, 3000)

    return () => clearTimeout(timeoutId)
  }, [location.search, navigate, connections, configLoaded])

  // Centralized keyboard shortcuts
  useKeyboardShortcuts({
    onCommandPalette: () => setIsCommandPaletteOpen(true),
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
          onCommandPaletteOpen={() => setIsCommandPaletteOpen(true)}
          onOpenConnectionOptions={handleOpenConnectionOptions}
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
          connections={connections}
          onNavigate={handleCommandPaletteNavigate}
          onServerSelect={handleServerSelect}
        />

        {/* Connection Options Dialog */}
      </div>
    </TooltipProvider>
  )
}
