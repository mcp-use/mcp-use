import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Shared utilities for MCP Inspector server functionality
 */

interface LLMConfig {
  provider: 'openai' | 'anthropic'
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaseLLM = any

interface ServerConfig {
  url: string
  headers?: Record<string, string>
  [key: string]: unknown
}

/**
 * Handle chat API request with MCP agent
 */
export async function handleChatRequest(requestBody: {
  mcpServerUrl: string
  llmConfig: LLMConfig
  authConfig?: AuthConfig
  messages: ChatMessage[]
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const { mcpServerUrl, llmConfig, authConfig, messages } = requestBody

  if (!mcpServerUrl || !llmConfig || !messages) {
    throw new Error('Missing required fields: mcpServerUrl, llmConfig, messages')
  }

  // Dynamically import mcp-use and LLM providers
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
      const auth = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')
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
      const auth = Buffer.from(`${url.username}:${url.password}`).toString('base64')
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

/**
 * Get content type for static assets
 */
export function getContentType(filePath: string): string {
  if (filePath.endsWith('.js')) {
    return 'application/javascript'
  }
  else if (filePath.endsWith('.css')) {
    return 'text/css'
  }
  else if (filePath.endsWith('.svg')) {
    return 'image/svg+xml'
  }
  else if (filePath.endsWith('.html')) {
    return 'text/html'
  }
  else if (filePath.endsWith('.json')) {
    return 'application/json'
  }
  else if (filePath.endsWith('.png')) {
    return 'image/png'
  }
  else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  else if (filePath.endsWith('.ico')) {
    return 'image/x-icon'
  }
  else {
    return 'application/octet-stream'
  }
}

/**
 * Check if client files exist
 */
export function checkClientFiles(clientDistPath: string): boolean {
  return existsSync(clientDistPath)
}

/**
 * Get client dist path
 */
export function getClientDistPath(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  return join(__dirname, '../../dist/client')
}
