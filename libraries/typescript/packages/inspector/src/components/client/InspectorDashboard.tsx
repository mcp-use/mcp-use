import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NotFound } from '@/components/ui/not-found'
import { RandomGradientBackground } from '@/components/ui/random-gradient-background'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  CircleMinus,
  Cog,
  Copy,
  FileText,
  Loader2,
  RotateCcw,
  Shield,
} from 'lucide-react'
import { useMcp } from 'mcp-use/react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useMcpContext } from '../../client/context/McpContext'
import type { CustomHeader } from './CustomHeadersEditor'
import { CustomHeadersEditor } from './CustomHeadersEditor'

// Temporary connection tester component
function ConnectionTester({
  config,
  onSuccess,
  onFailure,
}: {
  config: {
    url: string
    name: string
    proxyConfig?: {
      proxyAddress?: string
      proxyToken?: string
      customHeaders?: Record<string, string>
    }
    transportType?: 'http' | 'sse'
  }
  onSuccess: () => void
  onFailure: (error: string) => void
}) {
  const callbackUrl =
    typeof window !== 'undefined'
      ? new URL('/oauth/callback', window.location.origin).toString()
      : '/oauth/callback'

  // Apply proxy configuration
  let finalUrl = config.url
  let customHeaders: Record<string, string> = {}

  if (config.proxyConfig?.proxyAddress) {
    const proxyUrl = new URL(config.proxyConfig.proxyAddress)
    const originalUrl = new URL(config.url)
    finalUrl = `${proxyUrl.origin}${proxyUrl.pathname}${originalUrl.pathname}${originalUrl.search}`

    if (config.proxyConfig.proxyToken) {
      customHeaders['X-Proxy-Token'] = config.proxyConfig.proxyToken
    }
    customHeaders['X-Target-URL'] = config.url
  }

  if (config.proxyConfig?.customHeaders) {
    customHeaders = { ...customHeaders, ...config.proxyConfig.customHeaders }
  }

  const mcpHook = useMcp({
    url: finalUrl,
    callbackUrl,
    customHeaders:
      Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    transportType: config.transportType || 'http',
  })

  const hasCalledRef = useRef(false)

  useEffect(() => {
    if (hasCalledRef.current) return

    if (mcpHook.state === 'ready') {
      hasCalledRef.current = true
      // Don't clear storage on success - we want to keep the connection alive
      // The real McpConnectionWrapper will take over
      onSuccess()
    } else if (mcpHook.state === 'failed' || mcpHook.error) {
      hasCalledRef.current = true
      const errorMessage = mcpHook.error || 'Failed to connect to server'
      // Clear storage on failure to clean up the failed connection attempt
      mcpHook.clearStorage()
      onFailure(errorMessage)
    }
  }, [mcpHook.state, mcpHook.error, onSuccess, onFailure, mcpHook])

  return null
}

export function InspectorDashboard() {
  const mcpContext = useMcpContext()
  const {
    connections,
    addConnection,
    removeConnection,
    autoConnect,
    setAutoConnect,
    connectServer,
    disconnectServer: _disconnectServer,
  } = mcpContext
  const navigate = useNavigate()
  const [connectingServers, setConnectingServers] = useState<Set<string>>(
    new Set()
  )
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null
  )

  // Log connections on every render to debug
  console.warn(
    '[InspectorDashboard] Render - connections:',
    connections.map((c) => ({ id: c.id, state: c.state }))
  )

  // Form state
  const [transportType, setTransportType] = useState('SSE')
  const [url, setUrl] = useState('')
  const [connectionType, setConnectionType] = useState('Direct')
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([])
  const [requestTimeout, setRequestTimeout] = useState('10000')
  const [resetTimeoutOnProgress, setResetTimeoutOnProgress] = useState('True')
  const [maxTotalTimeout, setMaxTotalTimeout] = useState('60000')
  const [proxyAddress, setProxyAddress] = useState(
    `${window.location.origin}/inspector/api/proxy`
  )
  const [proxyToken, setProxyToken] = useState(
    'c96aeb0c195aa9c7d3846b90aec9bc5fcdd5df97b3049aaede8f5dd1a15d2d87'
  )

  // OAuth fields
  const [clientId, setClientId] = useState('')
  const [redirectUrl, setRedirectUrl] = useState(
    typeof window !== 'undefined'
      ? new URL('/oauth/callback', window.location.origin).toString()
      : '/oauth/callback'
  )
  const [scope, setScope] = useState('')

  // UI state
  const [headersDialogOpen, setHeadersDialogOpen] = useState(false)
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [autoSwitch, setAutoSwitch] = useState(true)
  const hasShownToastRef = useRef(false)
  const [hasTriedBothConnectionTypes, setHasTriedBothConnectionTypes] =
    useState(false)
  const [pendingConnectionConfig, setPendingConnectionConfig] = useState<{
    url: string
    name: string
    proxyConfig?: {
      proxyAddress?: string
      proxyToken?: string
      customHeaders?: Record<string, string>
    }
    transportType?: 'http' | 'sse'
  } | null>(null)

  // Load auto-switch setting from localStorage on mount
  useEffect(() => {
    const autoSwitchSetting = localStorage.getItem('mcp-inspector-auto-switch')
    if (autoSwitchSetting !== null) {
      setAutoSwitch(autoSwitchSetting === 'true')
    }
  }, [])

  const handleAddConnection = useCallback(() => {
    if (!url.trim()) return

    setIsConnecting(true)
    hasShownToastRef.current = false
    setHasTriedBothConnectionTypes(false)

    // Prepare proxy configuration if "Via Proxy" is selected
    const proxyConfig =
      connectionType === 'Via Proxy' && proxyAddress.trim()
        ? {
            proxyAddress: proxyAddress.trim(),
            proxyToken: proxyToken.trim(),
            customHeaders: customHeaders.reduce((acc, header) => {
              if (header.name && header.value) {
                acc[header.name] = header.value
              }
              return acc
            }, {} as Record<string, string>),
          }
        : {
            customHeaders: customHeaders.reduce((acc, header) => {
              if (header.name && header.value) {
                acc[header.name] = header.value
              }
              return acc
            }, {} as Record<string, string>),
          }

    // Map UI transport type to actual transport type
    // "SSE" in UI means "Streamable HTTP" which uses 'http' transport
    // "WebSocket" in UI means "WebSocket" which uses 'sse' transport
    const actualTransportType = transportType === 'SSE' ? 'http' : 'sse'

    // Store pending connection config - don't add to saved connections yet
    setPendingConnectionConfig({
      url,
      name: url,
      proxyConfig,
      transportType: actualTransportType,
    })
  }, [
    url,
    connectionType,
    proxyAddress,
    proxyToken,
    customHeaders,
    transportType,
  ])

  // Handle successful connection
  const handleConnectionSuccess = useCallback(() => {
    if (!pendingConnectionConfig) return

    console.warn('[InspectorDashboard] Connection ready! Saving to list...')
    setIsConnecting(false)

    // Add to saved connections now that it's successful
    addConnection(
      pendingConnectionConfig.url,
      pendingConnectionConfig.name,
      pendingConnectionConfig.proxyConfig,
      pendingConnectionConfig.transportType
    )

    setPendingConnectionConfig(null)
    toast.success('Connection established successfully')

    // Reset form
    setUrl('')
    setCustomHeaders([])
    setClientId('')
    setScope('')
  }, [pendingConnectionConfig, addConnection])

  // Handle failed connection
  const handleConnectionFailure = useCallback(
    (errorMessage: string) => {
      console.warn('[InspectorDashboard] Connection failed:', errorMessage)

      // Try auto-switch if enabled and we haven't tried both connection types yet
      if (autoSwitch && !hasTriedBothConnectionTypes) {
        const shouldTryProxy = connectionType === 'Direct'
        const shouldTryDirect = connectionType === 'Via Proxy'

        if (shouldTryProxy) {
          toast.error('Direct connection failed, trying with proxy...')
          setHasTriedBothConnectionTypes(true)
          // Clear pending config first to unmount the old ConnectionTester
          setPendingConnectionConfig(null)
          // Switch to proxy and retry after a brief delay
          setConnectionType('Via Proxy')
          setTimeout(() => {
            setIsConnecting(true)
            handleAddConnection()
          }, 1000) // Small delay to show the toast
        } else if (shouldTryDirect) {
          toast.error('Proxy connection failed, trying direct...')
          setHasTriedBothConnectionTypes(true)
          // Clear pending config first to unmount the old ConnectionTester
          setPendingConnectionConfig(null)
          // Switch to direct and retry after a brief delay
          setConnectionType('Direct')
          setTimeout(() => {
            setIsConnecting(true)
            handleAddConnection()
          }, 1000) // Small delay to show the toast
        }
      } else {
        toast.error(errorMessage)
        // Clear pending config on final failure
        setPendingConnectionConfig(null)
        setIsConnecting(false)
      }
    },
    [
      autoSwitch,
      hasTriedBothConnectionTypes,
      connectionType,
      handleAddConnection,
    ]
  )

  const handleClearAllConnections = () => {
    // Remove all connections
    connections.forEach((connection) => {
      removeConnection(connection.id)
    })
  }

  const handleCopyError = async (errorMessage: string) => {
    try {
      await navigator.clipboard.writeText(errorMessage)
      toast.success('Error message copied to clipboard')
    } catch {
      toast.error('Failed to copy error message')
    }
  }

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation()
    action()
  }

  const handleServerClick = (connection: any) => {
    // If disconnected, connect the server
    if (connection.state === 'disconnected') {
      console.warn(
        '[InspectorDashboard] Connecting server and setting pending navigation:',
        connection.id
      )
      setConnectingServers((prev) => new Set(prev).add(connection.id))
      setPendingNavigation(connection.id)
      connectServer(connection.id)
      return
    }

    if (connection.state !== 'ready') {
      toast.error('Server is not connected and cannot be inspected')
      return
    }
    navigate(`/servers/${encodeURIComponent(connection.id)}`)
  }

  // Monitor connecting servers and remove them from the set when they connect or fail
  useEffect(() => {
    connectingServers.forEach((serverId) => {
      const connection = connections.find((c) => c.id === serverId)
      if (
        connection &&
        (connection.state === 'ready' || connection.state === 'failed')
      ) {
        setConnectingServers((prev) => {
          const next = new Set(prev)
          next.delete(serverId)
          return next
        })
      }
    })
  }, [connections, connectingServers])

  // Monitor pending navigation and navigate when server becomes ready
  useEffect(() => {
    if (!pendingNavigation) return

    const connection = connections.find((c) => c.id === pendingNavigation)
    const hasData =
      (connection?.tools?.length || 0) > 0 ||
      (connection?.resources?.length || 0) > 0 ||
      (connection?.prompts?.length || 0) > 0

    console.warn('[InspectorDashboard] Pending navigation check:', {
      pendingNavigation,
      connectionState: connection?.state,
      hasData,
      toolsCount: connection?.tools?.length || 0,
    })

    // Navigate if connection is ready OR if it has loaded some data (partial success)
    if (
      connection &&
      (connection.state === 'ready' ||
        (hasData && connection.state !== 'connecting'))
    ) {
      console.warn('[InspectorDashboard] Navigating to server:', connection.id)
      setPendingNavigation(null)
      navigate(`/servers/${encodeURIComponent(connection.id)}`)
    }
    // Only cancel navigation if connection truly failed with no data loaded
    else if (
      connection &&
      connection.state === 'failed' &&
      !hasData &&
      connection.error
    ) {
      console.warn(
        '[InspectorDashboard] Connection failed with no data, canceling navigation'
      )
      setPendingNavigation(null)
    }
  }, [connections, pendingNavigation, navigate])

  const handleExportServerEntry = async () => {
    if (!url.trim()) {
      toast.error('Please enter a URL first')
      return
    }

    const serverEntry = {
      type: 'streamable-http',
      url,
      note: 'For Streamable HTTP connections, add this URL directly in your MCP Client',
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(serverEntry, null, 2))
      toast.success(
        'Streamable HTTP URL has been copied. Use this URL directly in your MCP Client.'
      )
    } catch {
      toast.error('Failed to copy server entry to clipboard')
    }
  }

  const handleExportServersFile = async () => {
    if (!url.trim()) {
      toast.error('Please enter a URL first')
      return
    }

    const serversFile = {
      mcpServers: {
        'default-server': {
          type: 'streamable-http',
          url,
          note: 'For Streamable HTTP connections, add this URL directly in your MCP Client',
        },
      },
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(serversFile, null, 2))
      toast.success(
        "Servers configuration has been copied to clipboard. Add this to your mcp.json file. Current testing server will be added as 'default-server'"
      )
    } catch {
      toast.error('Failed to copy servers file to clipboard')
    }
  }

  const enabledHeadersCount = customHeaders.filter(
    (h) => h.name && h.value
  ).length

  return (
    <div className="flex items-start justify-start gap-4 h-full relative">
      <div className="w-full px-6 pt-6 overflow-auto">
        <div className="flex items-center gap-3 relative z-10">
          <h2 className="text-2xl font-medium tracking-tight">MCP Inspector</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/mcp-use/mcp-use-ts"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block"
              >
                <Badge
                  variant="secondary"
                  className="text-xs cursor-pointer hover:bg-secondary/80 transition-colors"
                >
                  v
                  {(typeof window !== 'undefined' &&
                    (window as any).__INSPECTOR_VERSION__) ||
                    '1.0.0'}
                </Badge>
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <p>Visit GitHub</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-muted-foreground relative z-10">
          Inspect and debug MCP (Model Context Protocol) servers
        </p>

        <div className="space-y-4 mt-8">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-medium">Connected Servers</h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="auto-connect"
                  className="text-sm cursor-pointer"
                >
                  Auto-connect
                </Label>
                <Switch
                  id="auto-connect"
                  checked={autoConnect}
                  onCheckedChange={setAutoConnect}
                />
              </div>
              {connections.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAllConnections}
                >
                  Clear All
                </Button>
              )}
            </div>
          </div>
          {connections.length === 0 ? (
            <NotFound message="No servers connected yet. Add a server above to get started." />
          ) : (
            <div className="grid gap-3">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  onClick={() => handleServerClick(connection)}
                  className="group rounded-lg bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 p-4 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h4 className="font-semibold text-sm">
                          {connection.name}
                        </h4>
                        <div className="flex items-center gap-2">
                          {connectingServers.has(connection.id) ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                          ) : connection.error &&
                            connection.state !== 'ready' ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleCopyError(connection.error!)
                                  }}
                                  className="w-2 h-2 rounded-full bg-rose-500 animate-status-pulse-red hover:bg-rose-600 transition-colors"
                                  title="Click to copy error message"
                                  aria-label="Copy error message to clipboard"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">{connection.error}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <div
                              className={`w-2 h-2 rounded-full ${
                                connection.state === 'disconnected'
                                  ? 'bg-gray-400 dark:bg-gray-600'
                                  : connection.state === 'ready'
                                  ? 'bg-emerald-600 animate-status-pulse'
                                  : connection.state === 'failed'
                                  ? 'bg-rose-600 animate-status-pulse-red'
                                  : 'bg-yellow-500 animate-status-pulse-yellow'
                              }`}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground dark:text-zinc-400 font-mono">
                          {connection.url}
                        </p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigator.clipboard.writeText(connection.url)
                                toast.success('URL copied to clipboard')
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded"
                              title="Copy URL"
                            >
                              <Copy className="w-3 h-3 text-muted-foreground" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Copy URL</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) =>
                              handleActionClick(e, () =>
                                removeConnection(connection.id)
                              )
                            }
                            className="h-8 w-8 p-0"
                          >
                            <CircleMinus className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Remove connection</p>
                        </TooltipContent>
                      </Tooltip>
                      {connection.state !== 'disconnected' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(e) =>
                                handleActionClick(e, connection.retry)
                              }
                              className="h-8 w-8 p-0"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Resync connection</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  {connection.state === 'pending_auth' &&
                    connection.authUrl && (
                      <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={connection.authenticate}
                        >
                          Authenticate
                        </Button>{' '}
                        or{' '}
                        <a
                          href={connection.authUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          open auth page
                        </a>
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-full relative overflow-hidden h-full p-10 items-center justify-center flex">
        <div className="relative w-full max-w-xl mx-auto z-10 flex flex-col gap-3 rounded-3xl p-6 bg-black/70 dark:bg-black/90 shadow-2xl shadow-black/50 backdrop-blur-md">
          <h3 className="text-xl font-semibold text-white mb-2">Connect</h3>

          {/* Transport Type */}
          <div className="space-y-2">
            <Label className="text-white/90">Transport Type</Label>
            <Select value={transportType} onValueChange={setTransportType}>
              <SelectTrigger className="w-full bg-white/10 border-white/20 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SSE">
                  Streamable HTTP (Recommended)
                </SelectItem>
                <SelectItem value="WebSocket">
                  Server-Sent Events (SSE)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label className="text-white/90">URL</Label>
            <Input
              placeholder="http://localhost:3001/sse"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/50"
            />
          </div>

          {/* Connection Type */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-white/90">Connection Type</Label>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="auto-switch"
                  className="text-xs text-white/70 cursor-pointer"
                >
                  Auto-switch
                </Label>
                <Switch
                  id="auto-switch"
                  checked={autoSwitch}
                  onCheckedChange={(value) => {
                    setAutoSwitch(value)
                    localStorage.setItem(
                      'mcp-inspector-auto-switch',
                      String(value)
                    )
                  }}
                  className="scale-75"
                />
              </div>
            </div>
            <Select value={connectionType} onValueChange={setConnectionType}>
              <SelectTrigger className="w-full bg-white/10 border-white/20 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Direct">Direct</SelectItem>
                <SelectItem value="Via Proxy">Via Proxy</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Export Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="absolute top-2 right-2 text-white  hover:bg-white/20 z-10 dark:hover:bg-white/20"
              >
                <Copy className="w-4 h-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={handleExportServerEntry}>
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Server Entry
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportServersFile}>
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Servers File
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Configuration Buttons Row */}
          <div className="flex gap-3">
            {/* Authentication Button */}
            <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 justify-center bg-white/10 border-white/20 text-white hover:bg-white/20"
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
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </div>

                  {/* Redirect URL */}
                  <div className="space-y-2">
                    <Label className="text-sm">Redirect URL</Label>
                    <Input
                      value={redirectUrl}
                      onChange={(e) => setRedirectUrl(e.target.value)}
                    />
                  </div>

                  {/* Scope */}
                  <div className="space-y-2">
                    <Label className="text-sm">Scope</Label>
                    <Input
                      placeholder="Scope (space-separated)"
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
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
            <Dialog
              open={headersDialogOpen}
              onOpenChange={setHeadersDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 justify-center bg-white/10 border-white/20 text-white hover:bg-white/20"
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
                  className="flex-1 justify-center bg-white/10 border-white/20 text-white hover:bg-white/20"
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
                      onChange={(e) => setRequestTimeout(e.target.value)}
                    />
                  </div>

                  {/* Reset Timeout on Progress */}
                  <div className="space-y-2">
                    <Label className="text-sm flex items-center gap-1">
                      Reset Timeout on Progress
                      <span className="text-muted-foreground text-xs">(?)</span>
                    </Label>
                    <Select
                      value={resetTimeoutOnProgress}
                      onValueChange={setResetTimeoutOnProgress}
                    >
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
                      onChange={(e) => setMaxTotalTimeout(e.target.value)}
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
                      onChange={(e) => setProxyAddress(e.target.value)}
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
                      onChange={(e) => setProxyToken(e.target.value)}
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

          {/* Connect Button */}
          <Button
            onClick={handleAddConnection}
            disabled={!url.trim() || isConnecting}
            className="w-full bg-white text-black hover:bg-white/90 font-semibold mt-4"
          >
            {isConnecting ? (
              <>
                <svg
                  className="w-4 h-4 mr-2 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Connecting...
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                Connect
              </>
            )}
          </Button>
        </div>
        <RandomGradientBackground className="absolute inset-0" />
      </div>

      {/* Temporary connection tester - only rendered when testing a new connection */}
      {pendingConnectionConfig && (
        <ConnectionTester
          key={`${pendingConnectionConfig.url}-${pendingConnectionConfig.transportType}-${connectionType}`}
          config={pendingConnectionConfig}
          onSuccess={handleConnectionSuccess}
          onFailure={handleConnectionFailure}
        />
      )}
    </div>
  )
}
