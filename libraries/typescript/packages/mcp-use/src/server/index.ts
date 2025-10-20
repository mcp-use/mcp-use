export {
  createMCPServer,
  type McpServerInstance
} from './mcp-server.js'

export * from './types/index.js'

// MCP-UI adapter utility functions
export {
  buildWidgetUrl,
  createExternalUrlResource,
  createRawHtmlResource,
  createRemoteDomResource,
  createUIResourceFromDefinition,
  type UrlConfig
} from './adapters/mcp-ui-adapter.js'

export type {
  InputDefinition,
  PromptDefinition,
  PromptCallback,
  ResourceDefinition,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  ServerConfig,
  ToolDefinition,
  ToolCallback,
  // UIResource specific types
  UIResourceDefinition,
  ExternalUrlUIResource,
  RawHtmlUIResource,
  RemoteDomUIResource,
  WidgetProps,
  WidgetConfig,
  WidgetManifest,
  DiscoverWidgetsOptions,
} from './types/index.js'