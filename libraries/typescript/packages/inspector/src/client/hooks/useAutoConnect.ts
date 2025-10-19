import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { MCPConnection } from '@/client/context/McpContext'

interface UseAutoConnectOptions {
  connections: MCPConnection[]
  addConnection: (
    url: string,
    name?: string,
    proxyConfig?: {
      proxyAddress?: string
      customHeaders?: Record<string, string>
    },
    transportType?: 'http' | 'sse'
  ) => void
  removeConnection: (id: string) => void
}

interface AutoConnectState {
  isAutoConnecting: boolean
  autoConnectUrl: string | null
}

export function useAutoConnect({ connections, addConnection, removeConnection }: UseAutoConnectOptions): AutoConnectState {
  const navigate = useNavigate()
  const [isAutoConnecting, setIsAutoConnecting] = useState(false)
  const [autoConnectUrl, setAutoConnectUrl] = useState<string | null>(null)
  const [hasTriedBothModes, setHasTriedBothModes] = useState(false)
  const [useDirectMode, setUseDirectMode] = useState(true)
  const [autoSwitch, setAutoSwitch] = useState(true)
  const [configLoaded, setConfigLoaded] = useState(false)
  const retryScheduledRef = useRef(false)

  // Load auto-switch setting from localStorage
  useEffect(() => {
    const autoSwitchSetting = localStorage.getItem('mcp-inspector-auto-switch')
    if (autoSwitchSetting !== null) {
      setAutoSwitch(autoSwitchSetting === 'true')
    }
  }, [])

  // Load config and initiate auto-connect
  useEffect(() => {
    if (configLoaded) return

    // Check for autoConnect query parameter first
    const urlParams = new URLSearchParams(window.location.search)
    const queryAutoConnectUrl = urlParams.get('autoConnect')

    if (queryAutoConnectUrl) {
      const existing = connections.find(c => c.url === queryAutoConnectUrl)
      if (!existing) {
        setIsAutoConnecting(true)
        addConnection(queryAutoConnectUrl, 'Local MCP Server', undefined, 'http')
        navigate(`/?server=${encodeURIComponent(queryAutoConnectUrl)}`)
        const timeoutId = setTimeout(() => setIsAutoConnecting(false), 500)
        setConfigLoaded(true)
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
          const existing = connections.find(c => c.url === config.autoConnectUrl)
          if (!existing) {
            setAutoConnectUrl(config.autoConnectUrl)
            setHasTriedBothModes(false)
            setUseDirectMode(true)
            setIsAutoConnecting(true)
            addConnection(config.autoConnectUrl, 'Local MCP Server', undefined, 'http')
          }
        }
      })
      .catch(() => setConfigLoaded(true))
  }, [configLoaded, connections, addConnection, navigate])

  // Auto-connect retry logic
  useEffect(() => {
    if (!autoConnectUrl || hasTriedBothModes || !autoSwitch || retryScheduledRef.current) {
      return
    }

    const connection = connections.find(c => c.url === autoConnectUrl)

    // Handle failed connection - retry with alternate mode
    if (connection?.state === 'failed' && connection.error) {
      console.warn('[useAutoConnect] Connection failed, trying alternate mode...')
      removeConnection(connection.id)

      if (useDirectMode) {
        // Failed with direct, try proxy
        toast.error('Direct connection failed, trying with proxy...')
        setHasTriedBothModes(true)
        setUseDirectMode(false)
        retryScheduledRef.current = true

        queueMicrotask(() => {
          setTimeout(() => {
            const proxyAddress = `${window.location.origin}/inspector/api/proxy/mcp`
            console.warn('[useAutoConnect] Retrying with proxy:', proxyAddress)
            setIsAutoConnecting(true)
            retryScheduledRef.current = false
            addConnection(
              autoConnectUrl,
              'Local MCP Server',
              { proxyAddress, customHeaders: {} },
              'http',
            )
          }, 1000)
        })
      }
      else {
        // Both modes failed
        toast.error('Proxy connection also failed')
        setHasTriedBothModes(true)
        setIsAutoConnecting(false)
      }
    }
    // Handle successful connection
    else if (connection?.state === 'ready') {
      console.warn('[useAutoConnect] Connection succeeded, navigating to server')
      navigate(`/?server=${encodeURIComponent(autoConnectUrl)}`)

      setTimeout(() => {
        setAutoConnectUrl(null)
        setHasTriedBothModes(false)
        setIsAutoConnecting(false)
      }, 100)
    }
  }, [connections, autoConnectUrl, hasTriedBothModes, useDirectMode, autoSwitch, addConnection, removeConnection, navigate])

  // Clear loading state for query param auto-connects (simple case)
  useEffect(() => {
    if (isAutoConnecting && connections.length > 0 && !autoConnectUrl) {
      const hasEstablishedConnection = connections.some(
        conn => conn.state !== 'connecting' && conn.state !== 'loading',
      )
      if (hasEstablishedConnection) {
        const timeoutId = setTimeout(() => setIsAutoConnecting(false), 500)
        return () => clearTimeout(timeoutId)
      }
    }
  }, [isAutoConnecting, connections, autoConnectUrl])

  return { isAutoConnecting, autoConnectUrl }
}

