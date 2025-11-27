export {
  createMCPServer,
  type McpServerInstance,
  type ToolContext,
  type SampleOptions,
} from "./mcp-server.js";

export * from "./types/index.js";

// MCP-UI adapter utility functions
export {
  buildWidgetUrl,
  createExternalUrlResource,
  createRawHtmlResource,
  createRemoteDomResource,
  createUIResourceFromDefinition,
  type UrlConfig,
} from "./adapters/mcp-ui-adapter.js";

// Middleware adapter utility functions
export {
  adaptConnectMiddleware,
  adaptMiddleware,
  isExpressMiddleware,
} from "./connect-adapter.js";

export type {
  DiscoverWidgetsOptions,
  ExternalUrlUIResource,
  InputDefinition,
  PromptCallback,
  PromptDefinition,
  RawHtmlUIResource,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  RemoteDomUIResource,
  ResourceDefinition,
  ServerConfig,
  ToolCallback,
  ToolDefinition,
  // UIResource specific types
  UIResourceDefinition,
  WidgetConfig,
  WidgetManifest,
  WidgetProps,
} from "./types/index.js";
