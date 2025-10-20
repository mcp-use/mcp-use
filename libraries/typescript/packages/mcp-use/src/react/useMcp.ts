// useMcp.ts
import type {
    JSONRPCMessage,
    Prompt,
    Resource,
    ResourceTemplate,
    Tool
} from '@modelcontextprotocol/sdk/types.js';
import {
    CallToolResultSchema,
    GetPromptResultSchema,
    ListPromptsResultSchema,
    ListResourcesResultSchema,
    ListToolsResultSchema,
    ReadResourceResultSchema
} from '@modelcontextprotocol/sdk/types.js';
import { useCallback, useEffect, useRef, useState } from 'react';
// Import both transport types
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { sanitizeUrl } from 'strict-url-sanitise';
import { BrowserOAuthClientProvider } from '../auth/browser-provider.js';
import { assert } from '../utils/assert.js';
import type { UseMcpOptions, UseMcpResult } from './types.js';

const DEFAULT_RECONNECT_DELAY = 3000
const DEFAULT_RETRY_DELAY = 5000
const AUTH_TIMEOUT = 5 * 60 * 1000

// Define Transport types literal for clarity
type TransportType = 'http' | 'sse'

export function useMcp(options: UseMcpOptions): UseMcpResult {
  const {
    url,
    enabled = true,
    clientName,
    clientUri,
    callbackUrl = typeof window !== 'undefined'
      ? sanitizeUrl(new URL('/oauth/callback', window.location.origin).toString())
      : '/oauth/callback',
    storageKeyPrefix = 'mcp:auth',
    clientConfig = {},
    customHeaders = {},
    debug: _debug = false,
    autoRetry = false,
    autoReconnect = DEFAULT_RECONNECT_DELAY,
    transportType = 'auto',
    preventAutoAuth = false,
    onPopupWindow,
    timeout = 30000, // 30 seconds default for connection timeout
    sseReadTimeout = 300000, // 5 minutes default for SSE read timeout
  } = options

  const [state, setState] = useState<UseMcpResult['state']>('discovering')
  const [tools, setTools] = useState<Tool[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [resourceTemplates, setResourceTemplates] = useState<ResourceTemplate[]>([])
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [log, setLog] = useState<UseMcpResult['log']>([])
  const [authUrl, setAuthUrl] = useState<string | undefined>(undefined)

  const clientRef = useRef<Client | null>(null)
  const transportRef = useRef<Transport | null>(null)
  const authProviderRef = useRef<BrowserOAuthClientProvider | null>(null)
  const connectingRef = useRef<boolean>(false)
  const isMountedRef = useRef<boolean>(true)
  const connectAttemptRef = useRef<number>(0)
  const authTimeoutRef = useRef<number | null>(null)

  // --- Refs for values used in callbacks ---
  const stateRef = useRef(state)
  const autoReconnectRef = useRef(autoReconnect)
  const successfulTransportRef = useRef<TransportType | null>(null)

  // --- Effect to keep refs updated ---
  useEffect(() => {
    stateRef.current = state
    autoReconnectRef.current = autoReconnect
  }, [state, autoReconnect])

  // --- Stable Callbacks ---
  const addLog = useCallback(
    (level: UseMcpResult['log'][0]['level'], message: string, ...args: unknown[]) => {
      const fullMessage = args.length > 0 ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(' ')}` : message
      console[level](`[useMcp] ${fullMessage}`)
      if (isMountedRef.current) {
        setLog((prevLog) => [...prevLog.slice(-100), { level, message: fullMessage, timestamp: Date.now() }])
      }
    },
    [],
  )

  const disconnect = useCallback(
    async (quiet = false) => {
      if (!quiet) addLog('info', 'Disconnecting...')
      connectingRef.current = false
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
      authTimeoutRef.current = null

      const transport = transportRef.current
      clientRef.current = null
      transportRef.current = null

      if (isMountedRef.current && !quiet) {
        setState('discovering')
        setTools([])
        setResources([])
        setResourceTemplates([])
        setPrompts([])
        setError(undefined)
        setAuthUrl(undefined)
      }

      if (transport) {
        try {
          await transport.close()
          if (!quiet) addLog('debug', 'Transport closed')
        } catch (err) {
          if (!quiet) addLog('warn', 'Error closing transport:', err)
        }
      }
    },
    [addLog],
  )

  const failConnection = useCallback(
    (errorMessage: string, connectionError?: Error) => {
      addLog('error', errorMessage, connectionError ?? '')
      if (isMountedRef.current) {
        setState('failed')
        setError(errorMessage)
        const manualUrl = authProviderRef.current?.getLastAttemptedAuthUrl()
        if (manualUrl) {
          setAuthUrl(manualUrl)
          addLog('info', 'Manual authentication URL may be available.', manualUrl)
        }
      }
      connectingRef.current = false
    },
    [addLog],
  )

  const connect = useCallback(async () => {
    // Don't connect if not enabled or no URL provided
    if (!enabled || !url) {
      addLog('debug', enabled ? 'No server URL provided, skipping connection.' : 'Connection disabled via enabled flag.')
      return
    }

    if (connectingRef.current) {
      addLog('debug', 'Connection attempt already in progress.')
      return
    }
    if (!isMountedRef.current) {
      addLog('debug', 'Connect called after unmount, aborting.')
      return
    }

    connectingRef.current = true
    connectAttemptRef.current += 1
    setError(undefined)
    setAuthUrl(undefined)
    successfulTransportRef.current = null
    setState('discovering')
    addLog('info', `Connecting attempt #${connectAttemptRef.current} to ${url}...`)

    if (!authProviderRef.current) {
      authProviderRef.current = new BrowserOAuthClientProvider(url, {
        storageKeyPrefix,
        clientName,
        clientUri,
        callbackUrl,
        preventAutoAuth,
        onPopupWindow,
      })
      addLog('debug', 'BrowserOAuthClientProvider initialized in connect.')
    }
    if (!clientRef.current) {
      clientRef.current = new Client(
        { name: clientConfig.name || 'mcp-use', version: clientConfig.version || '0.1.0' },
        { capabilities: {} },
      )
      addLog('debug', 'MCP Client initialized in connect.')
    }

    const tryConnectWithTransport = async (transportTypeParam: TransportType, isAuthRetry = false): Promise<'success' | 'fallback' | 'auth_redirect' | 'failed'> => {
      addLog('info', `Attempting connection with ${transportTypeParam.toUpperCase()} transport${isAuthRetry ? ' (after auth)' : ''}...`)
      if (stateRef.current !== 'authenticating') {
        setState('connecting')
      }

      let transportInstance: Transport

      try {
        assert(authProviderRef.current, 'Auth Provider must be initialized')
        assert(clientRef.current, 'Client must be initialized')

        if (transportRef.current) {
          await transportRef.current.close().catch((e) => addLog('warn', `Error closing previous transport: ${e.message}`))
          transportRef.current = null
        }

        const commonOptions: SSEClientTransportOptions = {
          authProvider: authProviderRef.current,
          requestInit: {
            headers: {
              Accept: 'application/json, text/event-stream',
              ...customHeaders,
            },
          },
          // Note: The MCP SDK's SSEClientTransport doesn't expose timeout configuration directly
          // Timeout handling is managed by the underlying EventSource and browser/Node.js fetch implementations
          // The timeout and sseReadTimeout options are preserved for future use or custom implementations
        }
        const sanitizedUrl = sanitizeUrl(url)
        const targetUrl = new URL(sanitizedUrl)

        addLog('debug', `Creating ${transportTypeParam.toUpperCase()} transport for URL: ${targetUrl.toString()}`)

        if (transportTypeParam === 'http') {
          addLog('debug', 'Creating StreamableHTTPClientTransport...')
          transportInstance = new StreamableHTTPClientTransport(targetUrl, commonOptions)
          addLog('debug', 'StreamableHTTPClientTransport created successfully')
        } else {
          addLog('debug', 'Creating SSEClientTransport...')
          transportInstance = new SSEClientTransport(targetUrl, commonOptions)
          addLog('debug', 'SSEClientTransport created successfully')
        }
        transportRef.current = transportInstance
        addLog('debug', `${transportTypeParam.toUpperCase()} transport created and assigned to ref.`)
      } catch (err) {
        failConnection(
          `Failed to create ${transportTypeParam.toUpperCase()} transport: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined,
        )
        return 'failed'
      }

      transportInstance.onmessage = (message: JSONRPCMessage) => {
        addLog('debug', `[Transport] Received: ${JSON.stringify(message)}`)
        // @ts-ignore
        clientRef.current?.handleMessage?.(message)
      }
      transportInstance.onerror = (err: Error) => {
        addLog('warn', `Transport error event (${transportTypeParam.toUpperCase()}):`, err)
        failConnection(`Transport error (${transportTypeParam.toUpperCase()}): ${err.message}`, err)
      }
      transportInstance.onclose = () => {
        if (!isMountedRef.current || connectingRef.current) return

        addLog('info', `Transport connection closed (${successfulTransportRef.current || 'unknown'} type).`)
        const currentState = stateRef.current
        const currentAutoReconnect = autoReconnectRef.current

        if (currentState === 'ready' && currentAutoReconnect) {
          const delay = typeof currentAutoReconnect === 'number' ? currentAutoReconnect : DEFAULT_RECONNECT_DELAY
          addLog('info', `Attempting to reconnect in ${delay}ms...`)
          setState('connecting')
          setTimeout(() => {
            if (isMountedRef.current) {
              connect()
            }
          }, delay)
        } else if (currentState !== 'failed' && currentState !== 'authenticating') {
          failConnection('Cannot connect to server')
        }
      }

      try {
        addLog('info', `Connecting client via ${transportTypeParam.toUpperCase()}...`)
        await clientRef.current!.connect(transportInstance)

        addLog('info', `Client connected via ${transportTypeParam.toUpperCase()}. Loading tools, resources, and prompts...`)
        successfulTransportRef.current = transportTypeParam
        setState('loading')

        const toolsResponse = await clientRef.current!.request({ method: 'tools/list' }, ListToolsResultSchema)

        let resourcesResponse: { resources: Resource[]; resourceTemplates?: ResourceTemplate[] } = { resources: [], resourceTemplates: [] }
        try {
          resourcesResponse = await clientRef.current!.request({ method: 'resources/list' }, ListResourcesResultSchema)
        } catch (err) {
          addLog('debug', 'Server does not support resources/list method', err)
        }

        let promptsResponse: { prompts: Prompt[] } = { prompts: [] }
        try {
          promptsResponse = await clientRef.current!.request({ method: 'prompts/list' }, ListPromptsResultSchema)
        } catch (err) {
          addLog('debug', 'Server does not support prompts/list method', err)
        }

        if (isMountedRef.current) {
          setTools(toolsResponse.tools)
          setResources(resourcesResponse.resources)
          setResourceTemplates(Array.isArray(resourcesResponse.resourceTemplates) ? resourcesResponse.resourceTemplates : [])
          setPrompts(promptsResponse.prompts)
          const summary = [`Loaded ${toolsResponse.tools.length} tools`]
          if (
            resourcesResponse.resources.length > 0 ||
            (resourcesResponse.resourceTemplates && resourcesResponse.resourceTemplates.length > 0)
          ) {
            summary.push(`${resourcesResponse.resources.length} resources`)
            if (Array.isArray(resourcesResponse.resourceTemplates) && resourcesResponse.resourceTemplates.length > 0) {
              summary.push(`${resourcesResponse.resourceTemplates.length} resource templates`)
            }
          }
          if (promptsResponse.prompts.length > 0) {
            summary.push(`${promptsResponse.prompts.length} prompts`)
          }

          addLog('info', summary.join(', ') + '.')
          setState('ready')
          connectAttemptRef.current = 0
          return 'success'
        } else {
          return 'failed'
        }
      } catch (connectErr) {
        addLog('debug', `Client connect error via ${transportTypeParam.toUpperCase()}:`, connectErr)
        const errorInstance = connectErr instanceof Error ? connectErr : new Error(String(connectErr))

        const errorMessage = errorInstance.message
        const is404 = errorMessage.includes('404') || errorMessage.includes('Not Found')
        const is405 = errorMessage.includes('405') || errorMessage.includes('Method Not Allowed')
        const isLikelyCors =
          errorMessage === 'Failed to fetch' ||
          errorMessage === 'NetworkError when attempting to fetch resource.' ||
          errorMessage === 'Load failed'

        if (transportTypeParam === 'http' && (is404 || is405 || isLikelyCors)) {
          addLog('warn', `HTTP transport failed (${isLikelyCors ? 'CORS' : is404 ? '404' : '405'}), will try fallback.`)
          // Don't set error state here - we're falling back to SSE
          return 'fallback'
        }

        if (errorInstance instanceof UnauthorizedError || errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
          // Prevent infinite auth loops - only retry once after auth
          if (isAuthRetry) {
            addLog('error', 'Authentication failed even after successful token refresh. This may indicate a server issue.')
            failConnection('Authentication loop detected - auth succeeded but connection still unauthorized.')
            return 'failed'
          }

          addLog('info', 'Authentication required.')

          assert(authProviderRef.current, 'Auth Provider not available for auth flow')
          const existingTokens = await authProviderRef.current.tokens()

          if (preventAutoAuth && !existingTokens) {
            addLog('info', 'Authentication required but auto-auth prevented. User action needed.')
            setState('pending_auth')
            return 'auth_redirect'
          }

          if (stateRef.current !== 'authenticating' && stateRef.current !== 'pending_auth') {
            setState('authenticating')
            if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
            authTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                const currentState = stateRef.current
                if (currentState === 'authenticating') {
                  failConnection('Authentication timed out. Please try again.')
                }
              }
            }, AUTH_TIMEOUT) as any
          }

          try {
            assert(url, 'Server URL is required for authentication')
            // Extract base URL (origin) for OAuth discovery - OAuth metadata should be at the origin level
            const baseUrl = new URL(url).origin
            const authResult = await auth(authProviderRef.current, { serverUrl: baseUrl })

            if (!isMountedRef.current) return 'failed'

            if (authResult === 'AUTHORIZED') {
              addLog('info', 'Authentication successful via existing token or refresh. Retrying transport connection...')
              if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
              authTimeoutRef.current = null
              // Retry the same transport type with isAuthRetry=true to prevent loops
              return await tryConnectWithTransport(transportTypeParam, true)
            } else if (authResult === 'REDIRECT') {
              addLog('info', 'Redirecting for authentication. Waiting for callback...')
              return 'auth_redirect'
            }
          } catch (sdkAuthError) {
            if (!isMountedRef.current) return 'failed'
            if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
            failConnection(
              `Failed to initiate authentication: ${sdkAuthError instanceof Error ? sdkAuthError.message : String(sdkAuthError)}`,
              sdkAuthError instanceof Error ? sdkAuthError : undefined,
            )
            return 'failed'
          }
        }

        // Only call failConnection if this is SSE (no fallback available) or not in auto mode
        // In auto mode with HTTP, we'll return 'fallback' above for common errors
        failConnection(`Failed to connect via ${transportTypeParam.toUpperCase()}: ${errorMessage}`, errorInstance)
        return 'failed'
      }
    }

    let finalStatus: 'success' | 'auth_redirect' | 'failed' | 'fallback' = 'failed'

    if (transportType === 'sse') {
      addLog('debug', 'Using SSE-only transport mode')
      finalStatus = await tryConnectWithTransport('sse')
    } else if (transportType === 'http') {
      addLog('debug', 'Using HTTP-only transport mode')
      finalStatus = await tryConnectWithTransport('http')
    } else {
      addLog('debug', 'Using auto transport mode (HTTP with SSE fallback)')
      const httpResult = await tryConnectWithTransport('http')

      if (httpResult === 'fallback' && isMountedRef.current && stateRef.current !== 'authenticating') {
        addLog('info', 'HTTP failed, attempting SSE fallback...')
        const sseResult = await tryConnectWithTransport('sse')
        finalStatus = sseResult
      } else {
        finalStatus = httpResult
      }
    }

    // Reset connecting flag for all terminal states and auth_redirect
    // auth_redirect needs to reset the flag so the auth callback can reconnect
    if (finalStatus === 'success' || finalStatus === 'failed' || finalStatus === 'auth_redirect') {
      connectingRef.current = false
    }

    addLog('debug', `Connection sequence finished with status: ${finalStatus}`)
  }, [
    addLog,
    failConnection,
    disconnect,
    url,
    storageKeyPrefix,
    clientName,
    clientUri,
    callbackUrl,
    clientConfig.name,
    clientConfig.version,
    customHeaders,
    transportType,
    preventAutoAuth,
    onPopupWindow,
    enabled,
    timeout,
    sseReadTimeout,
  ])

  const callTool = useCallback(
    async (name: string, args?: Record<string, unknown>) => {
      if (stateRef.current !== 'ready' || !clientRef.current) {
        throw new Error(`MCP client is not ready (current state: ${state}). Cannot call tool "${name}".`)
      }
      addLog('info', `Calling tool: ${name}`, args)
      try {
        const result = await clientRef.current.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema)
        addLog('info', `Tool "${name}" call successful:`, result)
        return result
      } catch (err) {
        addLog('error', `Error calling tool "${name}": ${err instanceof Error ? err.message : String(err)}`, err)
        const errorInstance = err instanceof Error ? err : new Error(String(err))

        if (
          errorInstance instanceof UnauthorizedError ||
          errorInstance.message.includes('Unauthorized') ||
          errorInstance.message.includes('401')
        ) {
          addLog('warn', 'Tool call unauthorized, attempting re-authentication...')
          setState('authenticating')
          if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
          authTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              const currentState = stateRef.current
              if (currentState === 'authenticating') {
                failConnection('Authentication timed out. Please try again.')
              }
            }
          }, AUTH_TIMEOUT) as any

          try {
            assert(authProviderRef.current, 'Auth Provider not available for tool re-auth')
            assert(url, 'Server URL is required for authentication')
            // Extract base URL (origin) for OAuth discovery - OAuth metadata should be at the origin level
            const baseUrl = new URL(url).origin
            const authResult = await auth(authProviderRef.current, { serverUrl: baseUrl })

            if (!isMountedRef.current) return

            if (authResult === 'AUTHORIZED') {
              addLog('info', 'Re-authentication successful. Retrying tool call is recommended, or reconnecting.')
              if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
              connectingRef.current = false
              connect()
            } else if (authResult === 'REDIRECT') {
              addLog('info', 'Redirecting for re-authentication for tool call.')
            }
          } catch (sdkAuthError) {
            if (!isMountedRef.current) return
            if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
            failConnection(
              `Re-authentication failed: ${sdkAuthError instanceof Error ? sdkAuthError.message : String(sdkAuthError)}`,
              sdkAuthError instanceof Error ? sdkAuthError : undefined,
            )
          }
        }
        // Re-throw error if we're not currently waiting for authentication
        // Type assertion needed because state can change during async execution
        const currentState = stateRef.current as UseMcpResult['state']
        if (currentState !== 'authenticating') {
          throw err
        }
        return undefined
      }
    },
    [state, url, addLog, failConnection, connect],
  )

  const retry = useCallback(() => {
    if (stateRef.current === 'failed') {
      addLog('info', 'Retry requested...')
      connect()
    } else {
      addLog('warn', `Retry called but state is not 'failed' (state: ${stateRef.current}). Ignoring.`)
    }
  }, [addLog, connect])

  const authenticate = useCallback(async () => {
    addLog('info', 'Manual authentication requested...')
    const currentState = stateRef.current

    if (currentState === 'failed') {
      addLog('info', 'Attempting to reconnect and authenticate via retry...')
      retry()
    } else if (currentState === 'pending_auth') {
      addLog('info', 'Proceeding with authentication from pending state...')
      setState('authenticating')
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
      authTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          const currentStateValue = stateRef.current
          if (currentStateValue === 'authenticating') {
            failConnection('Authentication timed out. Please try again.')
          }
        }
      }, AUTH_TIMEOUT) as any

      try {
        assert(authProviderRef.current, 'Auth Provider not available for manual auth')
        assert(url, 'Server URL is required for authentication')
        // Extract base URL (origin) for OAuth discovery - OAuth metadata should be at the origin level
        const baseUrl = new URL(url).origin
        const authResult = await auth(authProviderRef.current, { serverUrl: baseUrl })

        if (!isMountedRef.current) return

        if (authResult === 'AUTHORIZED') {
          addLog('info', 'Manual authentication successful. Re-attempting connection...')
          if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
          connectingRef.current = false
          connect()
        } else if (authResult === 'REDIRECT') {
          addLog('info', 'Redirecting for manual authentication. Waiting for callback...')
        }
      } catch (authError) {
        if (!isMountedRef.current) return
        if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
        failConnection(
          `Manual authentication failed: ${authError instanceof Error ? authError.message : String(authError)}`,
          authError instanceof Error ? authError : undefined,
        )
      }
    } else if (currentState === 'authenticating') {
      addLog('warn', 'Already attempting authentication. Check for blocked popups or wait for timeout.')
      const manualUrl = authProviderRef.current?.getLastAttemptedAuthUrl()
      if (manualUrl && !authUrl) {
        setAuthUrl(manualUrl)
        addLog('info', 'Manual authentication URL retrieved:', manualUrl)
      }
    } else {
      addLog(
        'info',
        `Client not in a state requiring manual authentication trigger (state: ${currentState}). If needed, try disconnecting and reconnecting.`,
      )
    }
  }, [addLog, retry, authUrl, url, failConnection, connect])

  const clearStorage = useCallback(() => {
    if (authProviderRef.current) {
      const count = authProviderRef.current.clearStorage()
      addLog('info', `Cleared ${count} item(s) from localStorage for ${url}.`)
      setAuthUrl(undefined)
      disconnect()
    } else {
      addLog('warn', 'Auth provider not initialized, cannot clear storage.')
    }
  }, [url, addLog, disconnect])

  const listResources = useCallback(async () => {
    if (stateRef.current !== 'ready' || !clientRef.current) {
      throw new Error(`MCP client is not ready (current state: ${state}). Cannot list resources.`)
    }
    addLog('info', 'Listing resources...')
    try {
      const resourcesResponse = await clientRef.current.request({ method: 'resources/list' }, ListResourcesResultSchema)
      if (isMountedRef.current) {
        setResources(resourcesResponse.resources)
        setResourceTemplates(Array.isArray(resourcesResponse.resourceTemplates) ? resourcesResponse.resourceTemplates : [])
        addLog(
          'info',
          `Listed ${resourcesResponse.resources.length} resources, ${Array.isArray(resourcesResponse.resourceTemplates) ? resourcesResponse.resourceTemplates.length : 0} resource templates.`,
        )
      }
    } catch (err) {
      addLog('error', `Error listing resources: ${err instanceof Error ? err.message : String(err)}`, err)
      throw err
    }
  }, [state, addLog])

  const readResource = useCallback(
    async (uri: string) => {
      if (stateRef.current !== 'ready' || !clientRef.current) {
        throw new Error(`MCP client is not ready (current state: ${state}). Cannot read resource "${uri}".`)
      }
      addLog('info', `Reading resource: ${uri}`)
      try {
        const result = await clientRef.current.request({ method: 'resources/read', params: { uri } }, ReadResourceResultSchema)
        addLog('info', `Resource "${uri}" read successfully`)
        return result
      } catch (err) {
        addLog('error', `Error reading resource "${uri}": ${err instanceof Error ? err.message : String(err)}`, err)
        throw err
      }
    },
    [state, addLog],
  )

  const listPrompts = useCallback(async () => {
    if (stateRef.current !== 'ready' || !clientRef.current) {
      throw new Error(`MCP client is not ready (current state: ${state}). Cannot list prompts.`)
    }
    addLog('info', 'Listing prompts...')
    try {
      const promptsResponse = await clientRef.current.request({ method: 'prompts/list' }, ListPromptsResultSchema)
      if (isMountedRef.current) {
        setPrompts(promptsResponse.prompts)
        addLog('info', `Listed ${promptsResponse.prompts.length} prompts.`)
      }
    } catch (err) {
      addLog('error', `Error listing prompts: ${err instanceof Error ? err.message : String(err)}`, err)
      throw err
    }
  }, [state, addLog])

  const getPrompt = useCallback(
    async (name: string, args?: Record<string, string>) => {
      if (stateRef.current !== 'ready' || !clientRef.current) {
        throw new Error(`MCP client is not ready (current state: ${state}). Cannot get prompt "${name}".`)
      }
      addLog('info', `Getting prompt: ${name}`, args)
      try {
        const result = await clientRef.current.request({ method: 'prompts/get', params: { name, arguments: args } }, GetPromptResultSchema)
        addLog('info', `Prompt "${name}" retrieved successfully`)
        return result
      } catch (err) {
        addLog('error', `Error getting prompt "${name}": ${err instanceof Error ? err.message : String(err)}`, err)
        throw err
      }
    },
    [state, addLog],
  )

  // ===== Effects =====

  // Keep refs up to date with latest callbacks to avoid effect dependencies
  const connectRef = useRef(connect)
  const failConnectionRef = useRef(failConnection)
  
  useEffect(() => {
    connectRef.current = connect
    failConnectionRef.current = failConnection
  })

  useEffect(() => {
    const messageHandler = (event: globalThis.MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'mcp_auth_callback') {
        addLog('info', 'Received auth callback message.', event.data)
        if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
        authTimeoutRef.current = null

        if (event.data.success) {
          addLog('info', 'Authentication successful via popup. Reconnecting client...')
          
          // Check if already connecting
          if (connectingRef.current) {
            addLog('debug', 'Connection attempt already in progress, resetting flag to allow reconnection.')
          }
          
          // Reset the connecting flag and reconnect since auth just succeeded
          connectingRef.current = false
          
          // Small delay to ensure state is clean before reconnecting
          setTimeout(() => {
            if (isMountedRef.current) {
              addLog('debug', 'Initiating reconnection after successful auth callback.')
              connectRef.current()
            }
          }, 100)
        } else {
          failConnectionRef.current(`Authentication failed in callback: ${event.data.error || 'Unknown reason.'}`)
        }
      }
    }
    window.addEventListener('message', messageHandler)
    addLog('debug', 'Auth callback message listener added.')
    return () => {
      window.removeEventListener('message', messageHandler)
      addLog('debug', 'Auth callback message listener removed.')
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current)
    }
  }, [addLog])

  useEffect(() => {
    isMountedRef.current = true
    
    // Skip connection if disabled or no URL provided
    if (!enabled || !url) {
      addLog('debug', enabled ? 'No server URL provided, skipping connection.' : 'Connection disabled via enabled flag.')
      setState('discovering')
      return () => {
        isMountedRef.current = false
      }
    }
    
    addLog('debug', 'useMcp mounted, initiating connection.')
    connectAttemptRef.current = 0
    if (!authProviderRef.current || authProviderRef.current.serverUrl !== url) {
      authProviderRef.current = new BrowserOAuthClientProvider(url, {
        storageKeyPrefix,
        clientName,
        clientUri,
        callbackUrl,
        preventAutoAuth,
        onPopupWindow,
      })
      addLog('debug', 'BrowserOAuthClientProvider initialized/updated on mount/option change.')
    }
    connect()
    return () => {
      isMountedRef.current = false
      addLog('debug', 'useMcp unmounting, disconnecting.')
      disconnect(true)
    }
  }, [url, enabled, storageKeyPrefix, callbackUrl, clientName, clientUri, clientConfig.name, clientConfig.version])

  useEffect(() => {
    let retryTimeoutId: number | null = null
    if (state === 'failed' && autoRetry && connectAttemptRef.current > 0) {
      const delay = typeof autoRetry === 'number' ? autoRetry : DEFAULT_RETRY_DELAY
      addLog('info', `Connection failed, auto-retrying in ${delay}ms...`)
      retryTimeoutId = setTimeout(() => {
        if (isMountedRef.current && stateRef.current === 'failed') {
          retry()
        }
      }, delay) as any
    }
    return () => {
      if (retryTimeoutId) clearTimeout(retryTimeoutId)
    }
  }, [state, autoRetry, retry, addLog])

  return {
    state,
    tools,
    resources,
    resourceTemplates,
    prompts,
    error,
    log,
    authUrl,
    callTool,
    listResources,
    readResource,
    listPrompts,
    getPrompt,
    retry,
    disconnect,
    authenticate,
    clearStorage,
  }
}

