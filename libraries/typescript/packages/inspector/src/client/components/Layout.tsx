import type { ReactNode } from 'react'
import type { CustomHeader } from './CustomHeadersEditor'
import { Cog, FileText, FolderOpen, MessageCircle, MessageSquare, Settings, Shield, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import LogoAnimated from '@/components/LogoAnimated'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { useMcpContext } from '../context/McpContext'
import { AnimatedThemeToggler } from './AnimatedThemeToggler'
import { ChatTab } from './ChatTab'
import { CommandPalette } from './CommandPalette'
import { CustomHeadersEditor } from './CustomHeadersEditor'
import { PromptsTab } from './PromptsTab'
import { ResourcesTab } from './ResourcesTab'
import { ServerIcon } from './ServerIcon'
import { ToolsTab } from './ToolsTab'

interface LayoutProps {
  children: ReactNode
}

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

// Pulsing emerald dot component
function StatusDot({ status }: { status: string }) {
  const getStatusInfo = (statusValue: string) => {
    switch (statusValue) {
      case 'ready':
        return { color: 'bg-emerald-500', ringColor: 'ring-emerald-500', tooltip: 'Connected' }
      case 'failed':
        return { color: 'bg-red-500', ringColor: 'ring-red-500', tooltip: 'Failed' }
      default:
        return { color: 'bg-yellow-500', ringColor: 'ring-yellow-500', tooltip: statusValue }
    }
  }

  const { color, ringColor, tooltip } = getStatusInfo(status)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative">
          {/* Pulsing ring */}
          <div className={`absolute w-2 h-2 rounded-full ${ringColor} animate-ping`} />
          {/* Solid dot */}
          <div className={`relative w-2 h-2 rounded-full ${color}`} />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { connections, addConnection } = useMcpContext()
  const [activeTab, setActiveTab] = useState('tools')
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isAutoConnecting, setIsAutoConnecting] = useState(false)

  // Connection options dialog state
  const [connectionOptionsOpen, setConnectionOptionsOpen] = useState(false)
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)

  // Form state for connection options
  const [transportType, setTransportType] = useState('SSE')
  const [url, setUrl] = useState('')
  const [connectionType, setConnectionType] = useState('Direct')
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([])
  const [requestTimeout, setRequestTimeout] = useState('10000')
  const [resetTimeoutOnProgress, setResetTimeoutOnProgress] = useState('True')
  const [maxTotalTimeout, setMaxTotalTimeout] = useState('60000')
  const [proxyAddress, setProxyAddress] = useState('')
  const [proxyToken, setProxyToken] = useState('c96aeb0c195aa9c7d3846b90aec9bc5fcdd5df97b3049aaede8f5dd1a15d2d87')

  // OAuth fields
  const [clientId, setClientId] = useState('')
  const [redirectUrl, setRedirectUrl] = useState(
    typeof window !== 'undefined'
      ? new URL('/oauth/callback', window.location.origin).toString()
      : 'http://localhost:3000/oauth/callback',
  )
  const [scope, setScope] = useState('')

  // UI state for sub-dialogs
  const [headersDialogOpen, setHeadersDialogOpen] = useState(false)
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)

  const tabs = [
    { id: 'tools', label: 'Tools', icon: Wrench },
    { id: 'prompts', label: 'Prompts', icon: MessageSquare },
    { id: 'resources', label: 'Resources', icon: FolderOpen },
    { id: 'chat', label: 'Chat', icon: MessageCircle },
  ]

  const handleServerSelect = (serverId: string) => {
    const server = connections.find(c => c.id === serverId)
    if (!server || server.state !== 'ready') {
      toast.error('Server is not connected and cannot be inspected')
      return
    }
    setSelectedServerId(serverId)
    navigate(`/servers/${encodeURIComponent(serverId)}`)
  }

  const handleCommandPaletteNavigate = (tab: 'tools' | 'prompts' | 'resources', itemName?: string) => {
    setActiveTab(tab)
    // Store the item name to be selected in the respective tab
    if (itemName) {
      sessionStorage.setItem(`selected-${tab}`, itemName)
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

  const handleSaveConnectionOptions = () => {
    // Here you would implement the logic to save/update the connection options
    // For now, we'll just close the dialog
    setConnectionOptionsOpen(false)
    setEditingConnectionId(null)
    toast.success('Connection options saved')
  }

  const enabledHeadersCount = customHeaders.filter(h => h.name && h.value).length

  const selectedServer = connections.find(c => c.id === selectedServerId)

  // Aggregate tools, prompts, and resources from all connected servers
  // When a server is selected, use only that server's items
  // When no server is selected, aggregate from all ready servers and add server metadata
  const aggregatedTools = selectedServer
    ? selectedServer.tools.map(tool => ({ ...tool, _serverId: selectedServer.id }))
    : connections.flatMap(conn =>
        conn.state === 'ready'
          ? conn.tools.map(tool => ({ ...tool, _serverId: conn.id, _serverName: conn.name }))
          : [],
      )

  const aggregatedPrompts = selectedServer
    ? selectedServer.prompts.map(prompt => ({ ...prompt, _serverId: selectedServer.id }))
    : connections.flatMap(conn =>
        conn.state === 'ready'
          ? conn.prompts.map(prompt => ({ ...prompt, _serverId: conn.id, _serverName: conn.name }))
          : [],
      )

  const aggregatedResources = selectedServer
    ? selectedServer.resources.map(resource => ({ ...resource, _serverId: selectedServer.id }))
    : connections.flatMap(conn =>
        conn.state === 'ready'
          ? conn.resources.map(resource => ({ ...resource, _serverId: conn.id, _serverName: conn.name }))
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
        navigate(`/servers/${encodeURIComponent(autoConnectUrl)}`)
        setTimeout(() => {
          setIsAutoConnecting(false)
        }, 1000)
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
          const existing = connections.find(c => c.url === config.autoConnectUrl)
          if (!existing) {
            // Auto-connect to the local server
            addConnection(config.autoConnectUrl, 'Local MCP Server', undefined, 'http')
          }
        }
      })
      .catch(() => {
        setConfigLoaded(true)
      })
  }, [configLoaded, connections, addConnection])

  // Handle navigation logic based on current route and server selection
  useEffect(() => {
    const isServerRoute = location.pathname.startsWith('/servers/')
    const serverIdFromRoute = location.pathname.split('/servers/')[1]

    if (isServerRoute && serverIdFromRoute) {
      // Decode the server ID from the route
      const decodedServerId = decodeURIComponent(serverIdFromRoute)
      setSelectedServerId(decodedServerId)
    }
    else if (!isServerRoute) {
      // If we're not on a server route, clear the selected server
      setSelectedServerId(null)
    }
  }, [location.pathname])

  // If no server is selected and we're on a server route, navigate to root
  // But only after we've given connections time to load and establish
  useEffect(() => {
    const serverIdFromRoute = location.pathname.split('/servers/')[1]
    const decodedServerId = serverIdFromRoute ? decodeURIComponent(serverIdFromRoute) : null

    const isServerRoute = location.pathname.startsWith('/servers/')
    const hasServerId = selectedServerId === decodedServerId

    if (!isServerRoute || !hasServerId || !configLoaded) {
      return
    }

    // Check if any connection exists for this server
    const serverConnection = connections.find(conn => conn.id === decodedServerId)

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
      if (serverConnection.state === 'connecting' || serverConnection.state === 'loading' || serverConnection.state === 'discovering') {
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
  }, [selectedServer, location.pathname, navigate, selectedServerId, connections, configLoaded])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open command palette
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setIsCommandPaletteOpen(true)
      }
      // Escape to close command palette
      if (event.key === 'Escape') {
        setIsCommandPaletteOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Show loading spinner during auto-connection
  if (isAutoConnecting) {
    return (
      <div className="h-screen bg-white dark:bg-zinc-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-8 w-8 text-zinc-600 dark:text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Connecting to MCP server...</p>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="h-screen bg-[#f3f3f3] dark:bg-zinc-900 flex flex-col px-4 py-4 gap-4">
        {/* Header */}
        <header className=" w-full mx-auto">
          <div className="flex items-center justify-between">
            {/* Left side: Server dropdown + Tabs */}
            <div className="flex items-center space-x-6">
              {/* Server Selection Dropdown */}
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <ShimmerButton
                      className={
                        cn('min-w-[200px] p-0 px-1 text-sm h-11 justify-start bg-black dark:bg-white text-white dark:text-black border-black dark:border-white hover:bg-gray-800 dark:hover:bg-zinc-100 hover:border-gray-800 dark:hover:border-zinc-200', !selectedServer && 'pl-4', selectedServer && 'pr-4',
                        )
                      }
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
                          {selectedServer ? selectedServer.name : 'Select server to inspect'}
                        </span>
                        {selectedServer && (
                          <div className="flex items-center gap-2">
                            {selectedServer.error && selectedServer.state !== 'ready'
                              ? (
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
                                      <p className="max-w-xs">{selectedServer.error}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                )
                              : (
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
                    <DropdownMenuLabel>MCP Servers</DropdownMenuLabel>
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
                                  handleOpenConnectionOptions(connection.id)
                                }}
                              >
                                <Settings className="h-3 w-3" />
                              </Button>
                            </DropdownMenuItem>
                          ))
                        )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/')}>
                      <span className="text-blue-600 dark:text-blue-400">+ Add new server</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Gear icon button for selected server */}
                {selectedServer && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    onClick={() => handleOpenConnectionOptions(selectedServer.id)}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Tabs */}
              {selectedServer && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
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
                        <TabsTrigger key={tab.id} value={tab.id} icon={tab.icon}>
                          <div className="flex items-center gap-2">
                            {tab.label}
                            {count > 0 && (
                              <span className="bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs px-2 py-0.5 rounded-full font-medium">
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

            {/* Right side: Theme Toggle + Discord Button + Deploy Button + Logo */}
            <div className="flex items-center gap-4">
              <AnimatedThemeToggler className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors" />
              <Button
                variant="ghost"
                className="hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full"
                size="sm"
                asChild
              >
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
              {/* <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Rocket className="h-4 w-4" />
                    Deploy
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Deploy Your MCP Server</DialogTitle>
                    <DialogDescription>
                      Choose how you'd like to deploy your MCP server
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-start gap-2"
                      onClick={() => {
                        // Mock implementation for hosted deployment
                        // TODO: Implement actual deployment logic
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Rocket className="h-4 w-4" />
                        <span className="font-medium">Hosted on MCP Use</span>
                        <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-2 py-1 rounded">Free</span>
                      </div>
                      <p className="text-sm text-muted-foreground dark:text-zinc-400 text-left">
                        Deploy your server to our managed infrastructure with zero configuration
                      </p>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-start gap-2"
                      onClick={() => {
                        // Mock implementation for Docker deployment
                        // TODO: Implement actual deployment logic
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 bg-blue-500 rounded" />
                        <span className="font-medium">Docker</span>
                      </div>
                      <p className="text-sm text-muted-foreground dark:text-zinc-400 text-left">
                        Get Docker configuration files to deploy on your own infrastructure
                      </p>
                    </Button>
                  </div>
                </DialogContent>
              </Dialog> */}
              <LogoAnimated state="expanded" />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 w-full mx-auto bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-0 overflow-auto">
          {selectedServer && activeTab === 'tools'
            ? (
                <ToolsTab
                  tools={selectedServer.tools}
                  callTool={selectedServer.callTool}
                  isConnected={selectedServer.state === 'ready'}
                />
              )
            : selectedServer && activeTab === 'prompts'
              ? (
                  <PromptsTab
                    prompts={selectedServer.prompts}
                    callPrompt={selectedServer.callTool} // Using callTool for now, should be callPrompt when available
                    isConnected={selectedServer.state === 'ready'}
                  />
                )
              : selectedServer && activeTab === 'resources'
                ? (
                    <ResourcesTab
                      resources={selectedServer.resources}
                      readResource={selectedServer.readResource}
                      isConnected={selectedServer.state === 'ready'}
                    />
                  )
                : selectedServer && activeTab === 'chat'
                  ? (
                      <ChatTab
                        mcpServerUrl={selectedServer.url}
                        isConnected={selectedServer.state === 'ready'}
                        oauthState={selectedServer.state}
                        oauthError={selectedServer.error}
                      />
                    )
                  : (
                      children
                    )}
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
        <Dialog open={connectionOptionsOpen} onOpenChange={setConnectionOptionsOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingConnectionId ? 'Edit Connection Options' : 'Connection Options'}
              </DialogTitle>
              <DialogDescription>
                Configure connection settings for your MCP server
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Transport Type */}
              <div className="space-y-2">
                <Label>Transport Type</Label>
                <Select value={transportType} onValueChange={setTransportType}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SSE">Streamable HTTP</SelectItem>
                    <SelectItem value="WebSocket">WebSocket</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* URL */}
              <div className="space-y-2">
                <Label>URL</Label>
                <Input
                  placeholder="http://localhost:3001/sse"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                />
              </div>

              {/* Connection Type */}
              <div className="space-y-2">
                <Label>Connection Type</Label>
                <Select value={connectionType} onValueChange={setConnectionType}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Direct">Direct</SelectItem>
                    <SelectItem value="Via Proxy">Via Proxy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Configuration Buttons Row */}
              <div className="flex gap-3">
                {/* Authentication Button */}
                <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="flex-1 justify-center"
                    >
                      <Shield className="w-4 h-4 mr-2" />
                      Authentication
                      {(clientId || scope) && (
                        <Badge variant="secondary" className="ml-2">
                          OAuth 2.0
                        </Badge>
                      )}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Authentication</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <h4 className="text-sm font-medium">OAuth 2.0 Flow</h4>

                      {/* Client ID */}
                      <div className="space-y-2">
                        <Label className="text-sm">Client ID</Label>
                        <Input
                          placeholder="Client ID"
                          value={clientId}
                          onChange={e => setClientId(e.target.value)}
                        />
                      </div>

                      {/* Redirect URL */}
                      <div className="space-y-2">
                        <Label className="text-sm">Redirect URL</Label>
                        <Input
                          value={redirectUrl}
                          onChange={e => setRedirectUrl(e.target.value)}
                        />
                      </div>

                      {/* Scope */}
                      <div className="space-y-2">
                        <Label className="text-sm">Scope</Label>
                        <Input
                          placeholder="Scope (space-separated)"
                          value={scope}
                          onChange={e => setScope(e.target.value)}
                        />
                      </div>

                      <div className="flex justify-end">
                        <Button onClick={() => setAuthDialogOpen(false)}>
                          Save
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Custom Headers Button */}
                <Dialog open={headersDialogOpen} onOpenChange={setHeadersDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="flex-1 justify-center"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Custom Headers
                      {enabledHeadersCount > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {enabledHeadersCount}
                        </Badge>
                      )}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Custom Headers</DialogTitle>
                    </DialogHeader>
                    <CustomHeadersEditor
                      headers={customHeaders}
                      onChange={setCustomHeaders}
                      onSave={() => setHeadersDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>

                {/* Configuration Button */}
                <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="flex-1 justify-center"
                    >
                      <Cog className="w-4 h-4 mr-2" />
                      Configuration
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Configuration</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      {/* Request Timeout */}
                      <div className="space-y-2">
                        <Label className="text-sm flex items-center gap-1">
                          Request Timeout
                          <span className="text-muted-foreground text-xs">(?)</span>
                        </Label>
                        <Input
                          type="number"
                          value={requestTimeout}
                          onChange={e => setRequestTimeout(e.target.value)}
                        />
                      </div>

                      {/* Reset Timeout on Progress */}
                      <div className="space-y-2">
                        <Label className="text-sm flex items-center gap-1">
                          Reset Timeout on Progress
                          <span className="text-muted-foreground text-xs">(?)</span>
                        </Label>
                        <Select value={resetTimeoutOnProgress} onValueChange={setResetTimeoutOnProgress}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="True">True</SelectItem>
                            <SelectItem value="False">False</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Maximum Total Timeout */}
                      <div className="space-y-2">
                        <Label className="text-sm flex items-center gap-1">
                          Maximum Total Timeout
                          <span className="text-muted-foreground text-xs">(?)</span>
                        </Label>
                        <Input
                          type="number"
                          value={maxTotalTimeout}
                          onChange={e => setMaxTotalTimeout(e.target.value)}
                        />
                      </div>

                      {/* Inspector Proxy Address */}
                      <div className="space-y-2">
                        <Label className="text-sm flex items-center gap-1">
                          Inspector Proxy Address
                          <span className="text-muted-foreground text-xs">(?)</span>
                        </Label>
                        <Input
                          value={proxyAddress}
                          onChange={e => setProxyAddress(e.target.value)}
                          placeholder=""
                        />
                      </div>

                      {/* Proxy Session Token */}
                      <div className="space-y-2">
                        <Label className="text-sm flex items-center gap-1">
                          Proxy Session Token
                          <span className="text-muted-foreground text-xs">(?)</span>
                        </Label>
                        <Input
                          value={proxyToken}
                          onChange={e => setProxyToken(e.target.value)}
                          className="font-mono text-xs"
                        />
                      </div>

                      <div className="flex justify-end">
                        <Button onClick={() => setConfigDialogOpen(false)}>
                          Save
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Save Button */}
              <div className="flex justify-end">
                <Button onClick={handleSaveConnectionOptions}>
                  Save Connection Options
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
