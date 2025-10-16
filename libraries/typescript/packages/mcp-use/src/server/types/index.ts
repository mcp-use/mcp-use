/**
 * Centralized type exports for MCP server
 */

// Common types
export {
  ServerConfig,
  InputDefinition,
  ResourceAnnotations
} from './common.js'

// Resource types including UIResource
export {
  ResourceHandler,
  ResourceTemplateHandler,
  ResourceTemplateConfig,
  ResourceTemplateDefinition,
  ResourceDefinition,
  // UIResource specific types
  UIResourceContent,
  WidgetProps,
  UIEncoding,
  RemoteDomFramework,
  UIResourceDefinition,
  ExternalUrlUIResource,
  RawHtmlUIResource,
  RemoteDomUIResource,
  WidgetConfig,
  WidgetManifest,
  DiscoverWidgetsOptions,
  // Apps SDK types
  AppsSdkMetadata,
  AppsSdkToolMetadata
} from './resource.js'

// Tool types
export {
  ToolHandler,
  ToolDefinition
} from './tool.js'

// Prompt types
export {
  PromptHandler,
  PromptDefinition
} from './prompt.js'