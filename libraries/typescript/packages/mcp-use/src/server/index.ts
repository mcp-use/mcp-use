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
  PromptHandler,
  ResourceDefinition,
  ResourceHandler,
  ServerConfig,
  ToolDefinition,
  ToolHandler,
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