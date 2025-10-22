export interface BaseTelemetryEvent {
  name: string
  properties: Record<string, any>
}

export interface MCPInspectorOpenEventData {
  serverUrl?: string
  connectionCount?: number
}

export class MCPInspectorOpenEvent implements BaseTelemetryEvent {
  name = 'mcp_inspector_open'
  properties: Record<string, any>

  constructor(data: MCPInspectorOpenEventData) {
    this.properties = {
      server_url: data.serverUrl,
      connection_count: data.connectionCount,
    }
  }
}

export interface MCPToolExecutionEventData {
  toolName: string
  serverId?: string
  success: boolean
  duration?: number
  error?: string
}

export class MCPToolExecutionEvent implements BaseTelemetryEvent {
  name = 'mcp_tool_execution'
  properties: Record<string, any>

  constructor(data: MCPToolExecutionEventData) {
    this.properties = {
      tool_name: data.toolName,
      server_id: data.serverId,
      success: data.success,
      duration: data.duration,
      error: data.error,
    }
  }
}

export interface MCPResourceReadEventData {
  resourceUri: string
  serverId?: string
  success: boolean
  error?: string
}

export class MCPResourceReadEvent implements BaseTelemetryEvent {
  name = 'mcp_resource_read'
  properties: Record<string, any>

  constructor(data: MCPResourceReadEventData) {
    this.properties = {
      resource_uri: data.resourceUri,
      server_id: data.serverId,
      success: data.success,
      error: data.error,
    }
  }
}

export interface MCPPromptCallEventData {
  promptName: string
  serverId?: string
  success: boolean
  error?: string
}

export class MCPPromptCallEvent implements BaseTelemetryEvent {
  name = 'mcp_prompt_call'
  properties: Record<string, any>

  constructor(data: MCPPromptCallEventData) {
    this.properties = {
      prompt_name: data.promptName,
      server_id: data.serverId,
      success: data.success,
      error: data.error,
    }
  }
}

export interface MCPServerConnectionEventData {
  serverId: string
  serverUrl: string
  success: boolean
  connectionType?: 'http' | 'sse' | 'websocket'
  error?: string
}

export class MCPServerConnectionEvent implements BaseTelemetryEvent {
  name = 'mcp_server_connection'
  properties: Record<string, any>

  constructor(data: MCPServerConnectionEventData) {
    this.properties = {
      server_id: data.serverId,
      server_url: data.serverUrl,
      success: data.success,
      connection_type: data.connectionType,
      error: data.error,
    }
  }
}

export interface MCPChatMessageEventData {
  serverId?: string
  provider: 'openai' | 'anthropic' | 'google'
  model: string
  messageCount: number
  toolCallsCount?: number
  success: boolean
  executionMode: 'client-side' | 'server-side'
  duration?: number
  error?: string
}

export class MCPChatMessageEvent implements BaseTelemetryEvent {
  name = 'mcp_chat_message'
  properties: Record<string, any>

  constructor(data: MCPChatMessageEventData) {
    this.properties = {
      server_id: data.serverId,
      provider: data.provider,
      model: data.model,
      message_count: data.messageCount,
      tool_calls_count: data.toolCallsCount,
      success: data.success,
      execution_mode: data.executionMode,
      duration: data.duration,
      error: data.error,
    }
  }
}

export interface MCPServerAddedEventData {
  serverId: string
  serverUrl: string
  connectionType?: 'http' | 'sse'
  viaProxy?: boolean
}

export class MCPServerAddedEvent implements BaseTelemetryEvent {
  name = 'mcp_server_added'
  properties: Record<string, any>

  constructor(data: MCPServerAddedEventData) {
    this.properties = {
      server_id: data.serverId,
      server_url: data.serverUrl,
      connection_type: data.connectionType,
      via_proxy: data.viaProxy,
    }
  }
}

export interface MCPServerRemovedEventData {
  serverId: string
}

export class MCPServerRemovedEvent implements BaseTelemetryEvent {
  name = 'mcp_server_removed'
  properties: Record<string, any>

  constructor(data: MCPServerRemovedEventData) {
    this.properties = {
      server_id: data.serverId,
    }
  }
}

export interface MCPCommandPaletteOpenEventData {
  trigger: 'keyboard' | 'button'
}

export class MCPCommandPaletteOpenEvent implements BaseTelemetryEvent {
  name = 'mcp_command_palette_open'
  properties: Record<string, any>

  constructor(data: MCPCommandPaletteOpenEventData) {
    this.properties = {
      trigger: data.trigger,
    }
  }
}

export interface MCPToolSavedEventData {
  toolName: string
  serverId?: string
}

export class MCPToolSavedEvent implements BaseTelemetryEvent {
  name = 'mcp_tool_saved'
  properties: Record<string, any>

  constructor(data: MCPToolSavedEventData) {
    this.properties = {
      tool_name: data.toolName,
      server_id: data.serverId,
    }
  }
}
