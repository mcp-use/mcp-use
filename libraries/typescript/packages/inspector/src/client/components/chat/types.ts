export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string | Array<{ index: number, type: string, text: string }>
  timestamp: number
  parts?: Array<{
    type: 'text' | 'tool-invocation'
    text?: string
    toolInvocation?: {
      toolName: string
      args: Record<string, unknown>
      result?: any
      state?: 'pending' | 'result' | 'error'
    }
  }>
  toolCalls?: Array<{
    toolName: string
    args: Record<string, unknown>
    result?: any
  }>
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'google'
  apiKey: string
  model: string
  temperature?: number
}

export interface AuthConfig {
  type: 'none' | 'basic' | 'bearer' | 'oauth'
  username?: string
  password?: string
  token?: string
  oauthTokens?: {
    access_token?: string
    refresh_token?: string
    token_type?: string
  }
}

export interface MCPServerConfig {
  url?: string
  transport?: 'http' | 'websocket' | 'sse'
  headers?: Record<string, string>
  authToken?: string
  auth_token?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  ws_url?: string
  preferSse?: boolean
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

export const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  google: 'gemini-2.0-flash-exp',
}
