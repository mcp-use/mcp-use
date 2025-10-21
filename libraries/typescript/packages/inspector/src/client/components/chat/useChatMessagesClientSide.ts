import type { AuthConfig, LLMConfig, MCPConfig, MCPServerConfig, Message } from './types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { hashString } from './utils'

interface UseChatMessagesClientSideProps {
  // Legacy single-server support
  mcpServerUrl?: string
  authConfig?: AuthConfig | null
  // New multi-server support
  mcpConfig?: MCPConfig
  llmConfig: LLMConfig | null
  isConnected: boolean
  // Function to read resources from the MCP server
  readResource?: (uri: string) => Promise<any>
}

export function useChatMessagesClientSide({
  mcpServerUrl,
  authConfig,
  mcpConfig,
  llmConfig,
  isConnected,
  readResource,
}: UseChatMessagesClientSideProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const agentRef = useRef<any>(null)
  const clientRef = useRef<any>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const toolsMetadataRef = useRef<Map<string, any>>(new Map())

  // Cleanup agent and client on unmount or when config changes
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.closeAllSessions().catch(console.error)
      }
    }
  }, [mcpConfig, mcpServerUrl, llmConfig?.provider, llmConfig?.model])

  const sendMessage = useCallback(
    async (userInput: string) => {
      if (!userInput.trim() || !llmConfig || !isConnected) {
        return
      }

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userInput.trim(),
        timestamp: Date.now(),
      }

      setMessages(prev => [...prev, userMessage])
      setIsLoading(true)

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController()

      try {
        // Dynamically import mcp-use browser bundle
        const { MCPAgent, MCPClient } = await import('mcp-use/browser')

        // Helper function to resolve OAuth tokens
        const resolveOAuthTokens = async (serverUrl: string, authCfg?: AuthConfig) => {
          if (authCfg?.type === 'oauth') {
            try {
              const storageKeyPrefix = 'mcp:auth'
              const serverUrlHash = hashString(serverUrl)
              const storageKey = `${storageKeyPrefix}_${serverUrlHash}_tokens`
              const tokensStr = localStorage.getItem(storageKey)
              if (tokensStr) {
                const tokens = JSON.parse(tokensStr)
                return {
                  ...authCfg,
                  oauthTokens: tokens,
                }
              }
            }
            catch (error) {
              console.warn('Failed to retrieve OAuth tokens:', error)
            }
          }
          return authCfg
        }

        // Helper function to add auth headers to server config
        const addAuthHeaders = (serverCfg: MCPServerConfig, authCfg?: AuthConfig): MCPServerConfig => {
          if (!authCfg || authCfg.type === 'none') {
            return serverCfg
          }

          const headers = { ...serverCfg.headers }

          if (authCfg.type === 'basic' && authCfg.username && authCfg.password) {
            const auth = btoa(`${authCfg.username}:${authCfg.password}`)
            headers.Authorization = `Basic ${auth}`
          }
          else if (authCfg.type === 'bearer' && authCfg.token) {
            headers.Authorization = `Bearer ${authCfg.token}`
          }
          else if (authCfg.type === 'oauth' && authCfg.oauthTokens?.access_token) {
            const tokenType = authCfg.oauthTokens.token_type
              ? authCfg.oauthTokens.token_type.charAt(0).toUpperCase() + authCfg.oauthTokens.token_type.slice(1)
              : 'Bearer'
            headers.Authorization = `${tokenType} ${authCfg.oauthTokens.access_token}`
          }

          return { ...serverCfg, headers }
        }

        // Create MCP client
        let client: any

        if (mcpConfig) {
          // Multi-server config mode
          const configWithAuth: MCPConfig = { mcpServers: {} }

          // Process each server and add OAuth tokens if needed
          for (const [serverName, serverCfg] of Object.entries(mcpConfig.mcpServers)) {
            const serverUrl = serverCfg.url || serverCfg.ws_url || ''
            const authConfigResolved = await resolveOAuthTokens(serverUrl, authConfig || undefined)
            configWithAuth.mcpServers[serverName] = addAuthHeaders(serverCfg, authConfigResolved)
          }

          client = new MCPClient(configWithAuth)
        }
        else if (mcpServerUrl) {
          // Legacy single-server mode
          client = new MCPClient()

          const authConfigResolved = await resolveOAuthTokens(mcpServerUrl, authConfig || undefined)
          const serverConfig: MCPServerConfig = { url: mcpServerUrl }
          const serverConfigWithAuth = addAuthHeaders(serverConfig, authConfigResolved)

          const serverName = `inspector-${Date.now()}`
          client.addServer(serverName, serverConfigWithAuth)
        }
        else {
          throw new Error('Either mcpConfig or mcpServerUrl must be provided')
        }

        clientRef.current = client

        // Create LLM instance based on provider
        let llm: any
        if (llmConfig.provider === 'openai') {
          const { ChatOpenAI } = await import('@langchain/openai')
          llm = new ChatOpenAI({
            model: llmConfig.model,
            apiKey: llmConfig.apiKey,
            temperature: llmConfig.temperature,
          })
        }
        else if (llmConfig.provider === 'anthropic') {
          const { ChatAnthropic } = await import('@langchain/anthropic')
          llm = new ChatAnthropic({
            model: llmConfig.model,
            apiKey: llmConfig.apiKey,
            temperature: llmConfig.temperature,
          })
        }
        else if (llmConfig.provider === 'google') {
          const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai')
          llm = new ChatGoogleGenerativeAI({
            model: llmConfig.model,
            apiKey: llmConfig.apiKey,
            temperature: llmConfig.temperature,
          })
        }
        else {
          throw new Error(`Unsupported LLM provider: ${llmConfig.provider}`)
        }

        // Create agent with the client
        const agent = new MCPAgent({
          llm,
          client,
          maxSteps: 10,
          memoryEnabled: true,
          systemPrompt: 'You are a helpful assistant with access to MCP tools, prompts, and resources. Help users interact with the MCP server.',
        })
        agentRef.current = agent

        // Initialize agent (connects to server)
        await agent.initialize()

        // Store tools metadata for later reference
        try {
          // Access the client's internal tool definitions
          // The client should have the raw MCP tools stored
          const clientInternal = client as any

          // Try to get tools from the client's sessions
          if (clientInternal.sessions) {
            const sessionIds = Object.keys(clientInternal.sessions)
            if (sessionIds.length > 0) {
              const session = clientInternal.sessions[sessionIds[0]]
              if (session?.tools) {
                const tools = Object.values(session.tools) as any[]
                toolsMetadataRef.current = new Map(
                  tools.map((tool: any) => [
                    tool.name,
                    tool._meta || tool.metadata || {},
                  ]),
                )
                console.log('[useChatMessagesClientSide] Stored metadata for tools:', Array.from(toolsMetadataRef.current.keys()), 'sample:', tools[0])
              }
            }
          }

          // Fallback: access from agent's tools
          if (toolsMetadataRef.current.size === 0 && agent.client) {
            const agentClient = agent.client as any
            if (agentClient.sessions) {
              const sessionIds = Object.keys(agentClient.sessions)
              if (sessionIds.length > 0) {
                const session = agentClient.sessions[sessionIds[0]]
                if (session?.tools) {
                  const tools = Object.values(session.tools) as any[]
                  toolsMetadataRef.current = new Map(
                    tools.map((tool: any) => [
                      tool.name,
                      tool._meta || tool.metadata || {},
                    ]),
                  )
                  console.log('[useChatMessagesClientSide] Stored metadata from agent for tools:', Array.from(toolsMetadataRef.current.keys()))
                }
              }
            }
          }
        }
        catch (error) {
          console.warn('[useChatMessagesClientSide] Failed to load tools metadata:', error)
        }

        // Create assistant message that will be updated with streaming content
        const assistantMessageId = `assistant-${Date.now()}`
        let currentTextPart = ''
        const parts: Array<{
          type: 'text' | 'tool-invocation'
          text?: string
          toolInvocation?: {
            toolName: string
            args: Record<string, unknown>
            result?: any
            state?: string
          }
        }> = []

        // Add empty assistant message to start
        setMessages(prev => [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            parts: [],
          },
        ])

        // Stream events from the agent
        for await (const event of agent.streamEvents(userInput)) {
          // Check for abort
          if (abortControllerRef.current?.signal.aborted) {
            break
          }

          // Handle text streaming
          if (event.event === 'on_chat_model_stream' && event.data?.chunk?.text) {
            const text = event.data.chunk.text
            if (typeof text === 'string' && text.length > 0) {
              currentTextPart += text

              // Update or add text part
              const lastPart = parts[parts.length - 1]
              if (lastPart && lastPart.type === 'text') {
                lastPart.text = currentTextPart
              }
              else {
                parts.push({
                  type: 'text',
                  text: currentTextPart,
                })
              }

              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, parts: [...parts] }
                    : msg,
                ),
              )
            }
          }
          // Handle tool start
          else if (event.event === 'on_tool_start') {
            if (currentTextPart) {
              currentTextPart = ''
            }

            parts.push({
              type: 'tool-invocation',
              toolInvocation: {
                toolName: event.name || 'unknown',
                args: event.data?.input || {},
                state: 'pending',
              },
            })

            setMessages(prev =>
              prev.map(msg =>
                msg.id === assistantMessageId
                  ? { ...msg, parts: [...parts] }
                  : msg,
              ),
            )
          }
          // Handle tool end
          else if (event.event === 'on_tool_end') {
            const toolPart = parts.find(
              p =>
                p.type === 'tool-invocation'
                && p.toolInvocation?.toolName === event.name
                && !p.toolInvocation?.result,
            )

            console.log('[useChatMessagesClientSide] on_tool_end event:', {
              toolName: event.name,
              hasToolPart: !!toolPart,
              output: event.data?.output,
            })

            if (toolPart && toolPart.toolInvocation) {
              const result = event.data?.output
              toolPart.toolInvocation.result = result
              toolPart.toolInvocation.state = 'result'

              // Parse result to check for Apps SDK component in the result's _meta field
              let parsedResult = result
              if (typeof result === 'string') {
                try {
                  parsedResult = JSON.parse(result)
                }
                catch (error) {
                  console.warn('[useChatMessagesClientSide] Failed to parse result:', error)
                }
              }

              // Check result's _meta field for Apps SDK component
              const appsSdkUri = parsedResult?._meta?.['openai/outputTemplate']

              console.log('[useChatMessagesClientSide] Apps SDK check:', {
                toolName: event.name,
                hasParsedResult: !!parsedResult,
                hasMeta: !!parsedResult?._meta,
                appsSdkUri,
              })

              if (appsSdkUri && typeof appsSdkUri === 'string' && readResource) {
                // Fetch the resource in the background
                console.log('[useChatMessagesClientSide] Detected Apps SDK component, fetching resource:', appsSdkUri)
                ;(async () => {
                  try {
                    // Use the readResource function passed from the inspector connection
                    const resourceData = await readResource(appsSdkUri)

                    console.log('[useChatMessagesClientSide] Resource fetched:', resourceData)

                    // Extract structured content from parsed result
                    let structuredContent = null
                    if (parsedResult?.structuredContent) {
                      structuredContent = parsedResult.structuredContent
                    }
                    else if (Array.isArray(parsedResult) && parsedResult[0]) {
                      const firstResult = parsedResult[0]
                      if (firstResult.output?.value?.structuredContent) {
                        structuredContent = firstResult.output.value.structuredContent
                      }
                      else if (firstResult.structuredContent) {
                        structuredContent = firstResult.structuredContent
                      }
                      else if (firstResult.output?.value) {
                        structuredContent = firstResult.output.value
                      }
                    }

                    // Fallback to entire parsed result
                    if (!structuredContent) {
                      structuredContent = parsedResult
                    }

                    // Add the fetched resource contents to the result's content array
                    if (resourceData?.contents && Array.isArray(resourceData.contents)) {
                      // Convert resource contents to MCP resource format
                      const mcpResources = resourceData.contents.map((content: any) => ({
                        type: 'resource',
                        resource: content,
                      }))

                      console.log('[useChatMessagesClientSide] Created MCP resources:', mcpResources)

                      // Update the tool result with the fetched resources
                      if (toolPart.toolInvocation) {
                        const updatedResult = {
                          ...parsedResult,
                          content: [
                            ...(parsedResult.content || []),
                            ...mcpResources,
                          ],
                          structuredContent,
                        }

                        console.log('[useChatMessagesClientSide] Updated result:', updatedResult)
                        // Store as JSON string to match the format
                        toolPart.toolInvocation.result = JSON.stringify(updatedResult)

                        setMessages(prev =>
                          prev.map(msg =>
                            msg.id === assistantMessageId
                              ? { ...msg, parts: [...parts] }
                              : msg,
                          ),
                        )

                        console.log('[useChatMessagesClientSide] Messages state updated with resource')
                      }
                    }
                    else {
                      console.warn('[useChatMessagesClientSide] No contents in resourceData:', resourceData)
                    }
                  }
                  catch (error) {
                    console.error('Failed to fetch Apps SDK resource:', error)
                  }
                })()
              }

              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, parts: [...parts] }
                    : msg,
                ),
              )
            }
          }
        }

        // Final update
        setMessages(prev =>
          prev.map(msg =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  parts: [...parts],
                  content: '',
                }
              : msg,
          ),
        )

        // Cleanup
        await client.closeAllSessions()
      }
      catch (error) {
        console.error('Client-side agent error:', error)
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${
            error instanceof Error ? error.message : 'Unknown error occurred'
          }`,
          timestamp: Date.now(),
        }
        setMessages(prev => [...prev, errorMessage])

        // Cleanup on error
        if (clientRef.current) {
          try {
            await clientRef.current.closeAllSessions()
          }
          catch (e) {
            console.error('Error closing sessions:', e)
          }
        }
      }
      finally {
        setIsLoading(false)
        agentRef.current = null
        clientRef.current = null
        abortControllerRef.current = null
      }
    },
    [llmConfig, isConnected, mcpConfig, mcpServerUrl, authConfig, readResource],
  )

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
  }
}
