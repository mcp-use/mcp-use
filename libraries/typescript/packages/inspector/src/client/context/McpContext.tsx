import type { ReactNode } from 'react'
import { useMcp } from 'mcp-use/react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface MCPConnection {
  id: string
  url: string
  name: string
  state: string
  tools: any[]
  resources: any[]
  prompts: any[]
  error: string | null
  authUrl: string | null
  callTool: (toolName: string, args: any) => Promise<any>
  readResource: (uri: string) => Promise<any>
  authenticate: () => void
  retry: () => void
  clearStorage: () => void
}

interface McpContextType {
  connections: MCPConnection[]
  addConnection: (url: string, name?: string, proxyConfig?: { proxyAddress?: string, proxyToken?: string, customHeaders?: Record<string, string> }, transportType?: 'http' | 'sse') => void
  removeConnection: (id: string) => void
  getConnection: (id: string) => MCPConnection | undefined
}

const McpContext = createContext<McpContextType | undefined>(undefined)

interface SavedConnection {
  id: string
  url: string
  name: string
  proxyConfig?: { proxyAddress?: string, proxyToken?: string, customHeaders?: Record<string, string> }
  transportType?: 'http' | 'sse'
}

function McpConnectionWrapper({ url, name, proxyConfig, transportType, onUpdate, onRemove: _onRemove }: {
  url: string
  name: string
  proxyConfig?: { proxyAddress?: string, proxyToken?: string, customHeaders?: Record<string, string> }
  transportType?: 'http' | 'sse'
  onUpdate: (connection: MCPConnection) => void
  onRemove: () => void
}) {
  // Configure OAuth callback URL
  // Use /oauth/callback (which redirects to /inspector/oauth/callback) for compatibility
  // with existing OAuth app configurations
  const callbackUrl = typeof window !== 'undefined'
    ? new URL('/oauth/callback', window.location.origin).toString()
    : '/oauth/callback'

  // Apply proxy configuration if provided
  let finalUrl = url
  let customHeaders: Record<string, string> = {}

  if (proxyConfig?.proxyAddress) {
    // If proxy is configured, use the proxy address as the URL
    // For MCP connections, we need to append the SSE endpoint to the proxy URL
    const proxyUrl = new URL(proxyConfig.proxyAddress)
    const originalUrl = new URL(url)

    // Construct the final proxy URL by combining proxy base with original path
    finalUrl = `${proxyUrl.origin}${proxyUrl.pathname}${originalUrl.pathname}${originalUrl.search}`

    // Add proxy token as header if provided
    if (proxyConfig.proxyToken) {
      customHeaders['X-Proxy-Token'] = proxyConfig.proxyToken
    }
    // Add original URL as a header so the proxy knows where to forward the request
    customHeaders['X-Target-URL'] = url
  }

  // Merge any additional custom headers
  if (proxyConfig?.customHeaders) {
    customHeaders = { ...customHeaders, ...proxyConfig.customHeaders }
  }

  const mcpHook = useMcp({
    url: finalUrl,
    callbackUrl,
    customHeaders: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    transportType: transportType || 'http', // Default to 'http' for Streamable HTTP
  })
  const onUpdateRef = useRef(onUpdate)
  const prevConnectionRef = useRef<MCPConnection | null>(null)

  // Keep ref up to date
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  // Create a stable connection object
  // Only update when data actually changes
  useEffect(() => {
    // Use queueMicrotask to defer state updates and avoid React warnings
    // about updating one component while rendering another
    if (typeof queueMicrotask !== 'undefined') {
      queueMicrotask(() => {
        const connection: MCPConnection = {
          id: url,
          url,
          name,
          state: mcpHook.state,
          tools: mcpHook.tools,
          resources: mcpHook.resources,
          prompts: mcpHook.prompts,
          error: mcpHook.error ?? null,
          authUrl: mcpHook.authUrl ?? null,
          callTool: mcpHook.callTool,
          readResource: mcpHook.readResource,
          authenticate: mcpHook.authenticate,
          retry: mcpHook.retry,
          clearStorage: mcpHook.clearStorage,
        }

        // Only update if something actually changed
        const prev = prevConnectionRef.current
        if (!prev
          || prev.state !== connection.state
          || prev.error !== connection.error
          || prev.authUrl !== connection.authUrl
          || prev.tools.length !== connection.tools.length
          || prev.resources.length !== connection.resources.length
          || prev.prompts.length !== connection.prompts.length
        ) {
          prevConnectionRef.current = connection
          onUpdateRef.current(connection)
        }
      })
    }
    else {
      // Fallback for environments without queueMicrotask
      const connection: MCPConnection = {
        id: url,
        url,
        name,
        state: mcpHook.state,
        tools: mcpHook.tools,
        resources: mcpHook.resources,
        prompts: mcpHook.prompts,
        error: mcpHook.error ?? null,
        authUrl: mcpHook.authUrl ?? null,
        callTool: mcpHook.callTool,
        readResource: mcpHook.readResource,
        authenticate: mcpHook.authenticate,
        retry: mcpHook.retry,
        clearStorage: mcpHook.clearStorage,
      }

      // Only update if something actually changed
      const prev = prevConnectionRef.current
      if (!prev
        || prev.state !== connection.state
        || prev.error !== connection.error
        || prev.authUrl !== connection.authUrl
        || prev.tools.length !== connection.tools.length
        || prev.resources.length !== connection.resources.length
        || prev.prompts.length !== connection.prompts.length
      ) {
        prevConnectionRef.current = connection
        onUpdateRef.current(connection)
      }
    }
  }, [
    url,
    name,
    mcpHook.state,
    mcpHook.tools,
    mcpHook.resources,
    mcpHook.prompts,
    mcpHook.error,
    mcpHook.authUrl,
  ])

  return null
}

export function McpProvider({ children }: { children: ReactNode }) {
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([])
  const [activeConnections, setActiveConnections] = useState<Map<string, MCPConnection>>(new Map())
  const [connectionVersion, setConnectionVersion] = useState(0)

  // Load saved connections from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('mcp-inspector-connections')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Validate and filter out invalid connections
        const validConnections = Array.isArray(parsed)
          ? parsed.filter((conn: any) => {
              // Ensure connection has valid structure with string url and id
              return conn
                && typeof conn === 'object'
                && typeof conn.id === 'string'
                && typeof conn.url === 'string'
                && typeof conn.name === 'string'
            }).map((conn: any) => {
              // Migrate existing connections to include transportType
              if (!conn.transportType) {
                conn.transportType = 'http' // Default to 'http' for Streamable HTTP
              }
              return conn
            })
          : []

        // If we filtered out any invalid connections or migrated transport types, update localStorage
        const hasChanges = validConnections.length !== parsed.length
          || validConnections.some((conn: any) => conn.transportType === 'http' && !parsed.find((p: any) => p.id === conn.id && p.transportType))

        if (hasChanges) {
          console.warn('Updated connections in localStorage with transport type migration')
          localStorage.setItem('mcp-inspector-connections', JSON.stringify(validConnections))
        }

        setSavedConnections(validConnections)
      }
      catch (error) {
        console.error('Failed to parse saved connections:', error)
        // Clear corrupted localStorage
        localStorage.removeItem('mcp-inspector-connections')
      }
    }
  }, [])

  const updateConnection = useCallback((connection: MCPConnection) => {
    setActiveConnections(prev => new Map(prev).set(connection.id, connection))
    setConnectionVersion(v => v + 1)
  }, [])

  const addConnection = useCallback((url: string, name?: string, proxyConfig?: { proxyAddress?: string, proxyToken?: string, customHeaders?: Record<string, string> }, transportType?: 'http' | 'sse') => {
    const connectionName = name || url
    const newConnection: SavedConnection = {
      id: url,
      url,
      name: connectionName,
      proxyConfig,
      transportType: transportType || 'http', // Default to 'http' for Streamable HTTP
    }

    setSavedConnections((prev) => {
      // Check if connection already exists
      if (prev.some(c => c.id === url)) {
        return prev
      }
      const updated = [...prev, newConnection]
      localStorage.setItem('mcp-inspector-connections', JSON.stringify(updated))
      return updated
    })
  }, [])

  const removeConnection = useCallback((id: string) => {
    setSavedConnections((prev) => {
      const updated = prev.filter(c => c.id !== id)
      localStorage.setItem('mcp-inspector-connections', JSON.stringify(updated))
      return updated
    })

    setActiveConnections((prev) => {
      const next = new Map(prev)
      const connection = next.get(id)
      if (connection) {
        // Clear storage and remove connection
        try {
          connection.clearStorage()
        }
        catch (error) {
          console.error('Failed to clear storage:', error)
        }
        next.delete(id)
      }
      return next
    })
  }, [])

  const getConnection = useCallback((id: string) => {
    return activeConnections.get(id)
  }, [activeConnections])

  // Use connectionVersion to force array recreation when connections update
  const connections = useMemo(() => {
    const conns = Array.from(activeConnections.values())
    console.warn('[McpContext] Connections updated, version:', connectionVersion, 'count:', conns.length, 'states:', conns.map(c => `${c.id}:${c.state}`))
    return conns
  }, [activeConnections, connectionVersion])

  // Memoize the context value to prevent unnecessary re-renders and HMR issues
  const contextValue = useMemo(() => ({
    connections,
    addConnection,
    removeConnection,
    getConnection,
  }), [connections, addConnection, removeConnection, getConnection])

  return (
    <McpContext value={contextValue}>
      {savedConnections.map(saved => (
        <McpConnectionWrapper
          key={saved.id}
          url={saved.url}
          name={saved.name}
          proxyConfig={saved.proxyConfig}
          transportType={saved.transportType}
          onUpdate={updateConnection}
          onRemove={() => removeConnection(saved.id)}
        />
      ))}
      {children}
    </McpContext>
  )
}

export function useMcpContext() {
  const context = use(McpContext)
  if (!context) {
    throw new Error('useMcpContext must be used within McpProvider')
  }
  return context
}
