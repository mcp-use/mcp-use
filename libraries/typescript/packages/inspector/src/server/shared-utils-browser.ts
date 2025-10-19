/**
 * Browser-compatible utilities for MCP Inspector chat functionality
 * Works in both Node.js and browser environments without Node.js-specific APIs
 */

interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'google'
  model: string
  apiKey: string
  temperature?: number
}

interface OAuthTokens {
  access_token: string
  token_type?: string
  [key: string]: unknown
}

interface AuthConfig {
  type?: string
  clientId?: string
  redirectUri?: string
  scope?: string
  username?: string
  password?: string
  token?: string
  oauthTokens?: OAuthTokens
  [key: string]: unknown
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ToolCall {
  name: string
  arguments: Record<string, unknown>
  result?: unknown
}

// Type for LangChain LLM models - using any for flexibility with dynamic imports
type BaseLLM = any

interface ServerConfig {
  url: string
  headers?: Record<string, string>
  [key: string]: unknown
}

/**
 * Cross-platform base64 encoding utility
 */
function toBase64(str: string): string {
  // Check if we're in a browser environment
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(str)
  }
  // Node.js environment
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64')
  }
  // Fallback - shouldn't reach here in practice
  throw new Error('No base64 encoding method available')
}

/**
 * Handle chat API request with MCP agent (streaming)
 */
export async function* handleChatRequestStream(requestBody: {
  mcpServerUrl: string
  llmConfig: LLMConfig
  authConfig?: AuthConfig
  messages: ChatMessage[]
}): AsyncGenerator<string, void, void> {
  const { mcpServerUrl, llmConfig, authConfig, messages } = requestBody

  if (!mcpServerUrl || !llmConfig || !messages) {
    throw new Error('Missing required fields: mcpServerUrl, llmConfig, messages')
  }

  // Dynamically import mcp-use and LLM providers
  // Note: MCPClient supports multiple servers via client.addServer(name, config)
  const { MCPAgent, MCPClient } = await import('mcp-use')

  // Create LLM instance based on provider
  let llm: BaseLLM
  if (llmConfig.provider === 'openai') {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatOpenAI } = await import('@langchain/openai')
    llm = new ChatOpenAI({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    })
  }
  else if (llmConfig.provider === 'anthropic') {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatAnthropic } = await import('@langchain/anthropic')
    llm = new ChatAnthropic({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    })
  }
  else if (llmConfig.provider === 'google') {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai')
    llm = new ChatGoogleGenerativeAI({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    })
  }
  else {
    throw new Error(`Unsupported LLM provider: ${llmConfig.provider}`)
  }

  // Create MCP client and connect to server
  const client = new MCPClient()
  const serverName = `inspector-${Date.now()}`

  // Add server with potential authentication headers
  const serverConfig: ServerConfig = { url: mcpServerUrl }

  // Handle authentication - support both custom auth and OAuth
  if (authConfig && authConfig.type !== 'none') {
    serverConfig.headers = {}

    if (authConfig.type === 'basic' && authConfig.username && authConfig.password) {
      const auth = toBase64(`${authConfig.username}:${authConfig.password}`)
      serverConfig.headers.Authorization = `Basic ${auth}`
    }
    else if (authConfig.type === 'bearer' && authConfig.token) {
      serverConfig.headers.Authorization = `Bearer ${authConfig.token}`
    }
    else if (authConfig.type === 'oauth') {
      // For OAuth, use the tokens passed from the frontend
      if (authConfig.oauthTokens?.access_token) {
        const tokenType = authConfig.oauthTokens.token_type
          ? authConfig.oauthTokens.token_type.charAt(0).toUpperCase() + authConfig.oauthTokens.token_type.slice(1)
          : 'Bearer'
        serverConfig.headers.Authorization = `${tokenType} ${authConfig.oauthTokens.access_token}`
      }
    }
  }

  // If the URL contains authentication info, extract it (fallback)
  try {
    const url = new URL(mcpServerUrl)
    if (url.username && url.password && (!authConfig || authConfig.type === 'none')) {
      const auth = toBase64(`${url.username}:${url.password}`)
      serverConfig.headers = serverConfig.headers || {}
      serverConfig.headers.Authorization = `Basic ${auth}`
      serverConfig.url = `${url.protocol}//${url.host}${url.pathname}${url.search}`
    }
  }
  catch (error) {
    console.warn('Failed to parse MCP server URL for auth:', error)
  }

  client.addServer(serverName, serverConfig)

  // Create agent with user's LLM
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 10,
    memoryEnabled: true,
    systemPrompt: 'You are a helpful assistant with access to MCP tools, prompts, and resources. Help users interact with the MCP server.',
  })

  // Format messages - use only the last user message as the query
  const lastUserMessage = messages.filter((msg: any) => msg.role === 'user').pop()

  if (!lastUserMessage) {
    throw new Error('No user message found')
  }

  try {
    // Generate a unique message ID
    const messageId = `msg-${Date.now()}`

    // Send initial assistant message event (AI SDK format)
    yield `data: ${JSON.stringify({ type: 'message', id: messageId, role: 'assistant' })}\n\n`

    // Use streamEvents to get real-time updates
    for await (const event of agent.streamEvents(lastUserMessage.content)) {
      // Emit text content as it streams
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.text) {
        const text = event.data.chunk.text
        if (typeof text === 'string' && text.length > 0) {
          // AI SDK text event format
          yield `data: ${JSON.stringify({ type: 'text', id: messageId, content: text })}\n\n`
        }
      }
      else if (event.event === 'on_tool_start') {
        // Tool invocation started - AI SDK tool-call event
        const toolCallId = `tool-${event.name}-${Date.now()}`
        yield `data: ${JSON.stringify({
          type: 'tool-call',
          id: messageId,
          toolCallId,
          toolName: event.name,
          args: event.data?.input || {},
        })}\n\n`
      }
      else if (event.event === 'on_tool_end') {
        // Tool invocation completed - AI SDK tool-result event
        const toolCallId = `tool-${event.name}-${Date.now()}`
        yield `data: ${JSON.stringify({
          type: 'tool-result',
          id: messageId,
          toolCallId,
          toolName: event.name,
          result: event.data?.output,
        })}\n\n`
      }
    }

    // Send final done event
    yield `data: ${JSON.stringify({ type: 'done', id: messageId })}\n\n`
  }
  finally {
    // Clean up
    await client.closeAllSessions()
  }
}

/**
 * Handle chat API request with MCP agent (non-streaming, kept for backwards compatibility)
 */
export async function handleChatRequest(requestBody: {
  mcpServerUrl: string
  llmConfig: LLMConfig
  authConfig?: AuthConfig
  messages: ChatMessage[]
}): Promise<{ content: string, toolCalls: ToolCall[] }> {
  const { mcpServerUrl, llmConfig, authConfig, messages } = requestBody

  if (!mcpServerUrl || !llmConfig || !messages) {
    throw new Error('Missing required fields: mcpServerUrl, llmConfig, messages')
  }

  // Dynamically import mcp-use and LLM providers
  // Note: MCPClient supports multiple servers via client.addServer(name, config)
  const { MCPAgent, MCPClient } = await import('mcp-use')

  // Create LLM instance based on provider
  let llm: BaseLLM
  if (llmConfig.provider === 'openai') {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatOpenAI } = await import('@langchain/openai')
    llm = new ChatOpenAI({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    })
  }
  else if (llmConfig.provider === 'anthropic') {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatAnthropic } = await import('@langchain/anthropic')
    llm = new ChatAnthropic({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    })
  }
  else if (llmConfig.provider === 'google') {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai')
    llm = new ChatGoogleGenerativeAI({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    })
  }
  else {
    throw new Error(`Unsupported LLM provider: ${llmConfig.provider}`)
  }

  // Create MCP client and connect to server
  const client = new MCPClient()
  const serverName = `inspector-${Date.now()}`

  // Add server with potential authentication headers
  const serverConfig: ServerConfig = { url: mcpServerUrl }

  // Handle authentication - support both custom auth and OAuth
  if (authConfig && authConfig.type !== 'none') {
    serverConfig.headers = {}

    if (authConfig.type === 'basic' && authConfig.username && authConfig.password) {
      const auth = toBase64(`${authConfig.username}:${authConfig.password}`)
      serverConfig.headers.Authorization = `Basic ${auth}`
    }
    else if (authConfig.type === 'bearer' && authConfig.token) {
      serverConfig.headers.Authorization = `Bearer ${authConfig.token}`
    }
    else if (authConfig.type === 'oauth') {
      // For OAuth, use the tokens passed from the frontend
      if (authConfig.oauthTokens?.access_token) {
        // Capitalize the token type (e.g., "bearer" -> "Bearer")
        const tokenType = authConfig.oauthTokens.token_type
          ? authConfig.oauthTokens.token_type.charAt(0).toUpperCase() + authConfig.oauthTokens.token_type.slice(1)
          : 'Bearer'
        serverConfig.headers.Authorization = `${tokenType} ${authConfig.oauthTokens.access_token}`
        console.log('Using OAuth access token for MCP server authentication')
        console.log('Authorization header:', `${tokenType} ${authConfig.oauthTokens.access_token.substring(0, 20)}...`)
      }
      else {
        console.warn('OAuth selected but no access token provided')
      }
    }
  }

  // If the URL contains authentication info, extract it (fallback)
  try {
    const url = new URL(mcpServerUrl)
    if (url.username && url.password && (!authConfig || authConfig.type === 'none')) {
      // Extract auth from URL
      const auth = toBase64(`${url.username}:${url.password}`)
      serverConfig.headers = serverConfig.headers || {}
      serverConfig.headers.Authorization = `Basic ${auth}`
      // Remove auth from URL to avoid double encoding
      serverConfig.url = `${url.protocol}//${url.host}${url.pathname}${url.search}`
    }
  }
  catch (error) {
    // If URL parsing fails, use original URL
    console.warn('Failed to parse MCP server URL for auth:', error)
  }

  // Debug: Log the server config being used
  console.log('Adding server with config:', {
    url: serverConfig.url,
    hasHeaders: !!serverConfig.headers,
    headers: serverConfig.headers,
  })

  client.addServer(serverName, serverConfig)

  // Create agent with user's LLM
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 10,
    memoryEnabled: true,
    systemPrompt: 'You are a helpful assistant with access to MCP tools, prompts, and resources. Help users interact with the MCP server.',
  })

  // Format messages - use only the last user message as the query
  const lastUserMessage = messages.filter((msg: any) => msg.role === 'user').pop()

  if (!lastUserMessage) {
    throw new Error('No user message found')
  }

  // Get response from agent
  const response = await agent.run(lastUserMessage.content)

  // Clean up
  await client.closeAllSessions()

  return {
    content: response,
    toolCalls: [],
  }
}

