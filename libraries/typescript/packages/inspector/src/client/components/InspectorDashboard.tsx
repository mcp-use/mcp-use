import type { CustomHeader } from './CustomHeadersEditor'
import { CircleMinus, Copy, Loader2, RotateCcw } from 'lucide-react'
import { useMcp } from 'mcp-use/react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/client/components/ui/badge'
import { Button } from '@/client/components/ui/button'
import { Label } from '@/client/components/ui/label'
import { NotFound } from '@/client/components/ui/not-found'
import { RandomGradientBackground } from '@/client/components/ui/random-gradient-background'
import { Switch } from '@/client/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/client/components/ui/tooltip'
import { useMcpContext } from '@/client/context/McpContext'
import { ConnectionSettingsForm } from './ConnectionSettingsForm'

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
  const callbackUrl
    = typeof window !== 'undefined'
      ? new URL('/inspector/oauth/callback', window.location.origin).toString()
      : '/inspector/oauth/callback'

  // Apply proxy configuration
  let finalUrl = config.url
  let customHeaders: Record<string, string> = {}

  if (config.proxyConfig?.proxyAddress) {
    const proxyUrl = new URL(config.proxyConfig.proxyAddress)
    const originalUrl = new URL(config.url)
    finalUrl = `${proxyUrl.origin}${proxyUrl.pathname}${originalUrl.pathname}${originalUrl.search}`

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
    if (hasCalledRef.current)
      return

    if (mcpHook.state === 'ready') {
      hasCalledRef.current = true
      // Don't clear storage on success - we want to keep the connection alive
      // The real McpConnectionWrapper will take over
      onSuccess()
    }
    else if (
      mcpHook.state === 'authenticating'
      || mcpHook.state === 'pending_auth'
    ) {
      // Authentication is in progress - keep waiting for OAuth callback

    }
    else if (mcpHook.state === 'failed' && mcpHook.error) {
      // If there's an authUrl available, authentication is in progress - don't fail yet
      if (mcpHook.authUrl) {
        return
      }
      hasCalledRef.current = true
      const errorMessage = mcpHook.error
      // Clear storage on failure to clean up the failed connection attempt
      mcpHook.clearStorage()
      onFailure(errorMessage)
    }
  }, [
    mcpHook.state,
    mcpHook.error,
    mcpHook.authUrl,
    onSuccess,
    onFailure,
    mcpHook,
  ])

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
    new Set(),
  )
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null,
  )

  // Log connections on every render to debug
  console.warn(
    '[InspectorDashboard] Render - connections:',
    connections.map(c => ({ id: c.id, state: c.state })),
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
    `${window.location.origin}/inspector/api/proxy`,
  )
  // OAuth fields
  const [clientId, setClientId] = useState('')
  const [redirectUrl, setRedirectUrl] = useState(
    typeof window !== 'undefined'
      ? new URL('/inspector/oauth/callback', window.location.origin).toString()
      : '/inspector/oauth/callback',
  )
  const [scope, setScope] = useState('')

  // UI state
  const [isConnecting, setIsConnecting] = useState(false)
  const [autoSwitch, setAutoSwitch] = useState(true)
  const hasShownToastRef = useRef(false)
  const [hasTriedBothConnectionTypes, setHasTriedBothConnectionTypes]
    = useState(false)
  const [pendingConnectionConfig, setPendingConnectionConfig] = useState<{
    url: string
    name: string
    proxyConfig?: {
      proxyAddress?: string
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
    if (!url.trim())
      return

    setIsConnecting(true)
    hasShownToastRef.current = false
    setHasTriedBothConnectionTypes(false)

    // Prepare proxy configuration if "Via Proxy" is selected
    const proxyConfig
      = connectionType === 'Via Proxy' && proxyAddress.trim()
        ? {
            proxyAddress: proxyAddress.trim(),
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
  }, [url, connectionType, proxyAddress, customHeaders, transportType])

  // Handle successful connection
  const handleConnectionSuccess = useCallback(() => {
    if (!pendingConnectionConfig)
      return

    console.warn('[InspectorDashboard] Connection ready! Saving to list...')
    setIsConnecting(false)

    // Add to saved connections now that it's successful
    addConnection(
      pendingConnectionConfig.url,
      pendingConnectionConfig.name,
      pendingConnectionConfig.proxyConfig,
      pendingConnectionConfig.transportType,
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
        }
        else if (shouldTryDirect) {
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
      }
      else {
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
    ],
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
    }
    catch {
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
        connection.id,
      )
      setConnectingServers(prev => new Set(prev).add(connection.id))
      setPendingNavigation(connection.id)
      connectServer(connection.id)
      return
    }

    if (connection.state !== 'ready') {
      toast.error('Server is not connected and cannot be inspected')
      return
    }
    navigate(`/?server=${encodeURIComponent(connection.id)}`)
  }

  // Monitor connecting servers and remove them from the set when they connect or fail
  useEffect(() => {
    connectingServers.forEach((serverId) => {
      const connection = connections.find(c => c.id === serverId)
      if (
        connection
        && (connection.state === 'ready' || connection.state === 'failed')
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
    if (!pendingNavigation)
      return

    const connection = connections.find(c => c.id === pendingNavigation)
    const hasData
      = (connection?.tools?.length || 0) > 0
        || (connection?.resources?.length || 0) > 0
        || (connection?.prompts?.length || 0) > 0

    console.warn('[InspectorDashboard] Pending navigation check:', {
      pendingNavigation,
      connectionState: connection?.state,
      hasData,
      toolsCount: connection?.tools?.length || 0,
    })

    // Navigate if connection is ready OR if it has loaded some data (partial success)
    if (
      connection
      && (connection.state === 'ready'
        || (hasData && connection.state !== 'connecting'))
    ) {
      console.warn('[InspectorDashboard] Navigating to server:', connection.id)
      setPendingNavigation(null)
      navigate(`/?server=${encodeURIComponent(connection.id)}`)
    }
    // Only cancel navigation if connection truly failed with no data loaded
    else if (
      connection
      && connection.state === 'failed'
      && !hasData
      && connection.error
    ) {
      console.warn(
        '[InspectorDashboard] Connection failed with no data, canceling navigation',
      )
      setPendingNavigation(null)
    }
  }, [connections, pendingNavigation, navigate])

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
                  {(typeof window !== 'undefined'
                    && (window as any).__INSPECTOR_VERSION__)
                  || '1.0.0'}
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
          {connections.length === 0
            ? (
                <NotFound message="No servers connected yet. Add a server above to get started." />
              )
            : (
                <div className="grid gap-3">
                  {connections.map(connection => (
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
                              {connectingServers.has(connection.id)
                                ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                                  )
                                : connection.error
                                  && connection.state !== 'ready'
                                  ? (
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
                                    )
                                  : (
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
                                onClick={e =>
                                  handleActionClick(e, () =>
                                    removeConnection(connection.id))}
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
                                  onClick={e =>
                                    handleActionClick(e, connection.retry)}
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
                      {connection.state === 'pending_auth'
                        && connection.authUrl && (
                        <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={connection.authenticate}
                          >
                            Authenticate
                          </Button>
                          {' '}
                          or
                          {' '}
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
          <ConnectionSettingsForm
            transportType={transportType}
            setTransportType={setTransportType}
            url={url}
            setUrl={setUrl}
            connectionType={connectionType}
            setConnectionType={setConnectionType}
            customHeaders={customHeaders}
            setCustomHeaders={setCustomHeaders}
            requestTimeout={requestTimeout}
            setRequestTimeout={setRequestTimeout}
            resetTimeoutOnProgress={resetTimeoutOnProgress}
            setResetTimeoutOnProgress={setResetTimeoutOnProgress}
            maxTotalTimeout={maxTotalTimeout}
            setMaxTotalTimeout={setMaxTotalTimeout}
            proxyAddress={proxyAddress}
            setProxyAddress={setProxyAddress}
            clientId={clientId}
            setClientId={setClientId}
            redirectUrl={redirectUrl}
            setRedirectUrl={setRedirectUrl}
            scope={scope}
            setScope={setScope}
            autoSwitch={autoSwitch}
            setAutoSwitch={setAutoSwitch}
            onConnect={handleAddConnection}
            variant="styled"
            showConnectButton={true}
            showExportButton={true}
            isConnecting={isConnecting}
          />
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
