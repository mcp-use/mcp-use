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
  ReadResourceCallback,
  ReadResourceTemplateCallback,
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
  AppsSdkUIResource,
  WidgetConfig,
  WidgetManifest,
  DiscoverWidgetsOptions,
  // Apps SDK types
  AppsSdkMetadata,
  AppsSdkToolMetadata
} from './resource.js'

// Tool types
export {
  ToolCallback,
  ToolDefinition
} from './tool.js'

// Prompt types
export {
  PromptCallback,
  PromptDefinition
} from './prompt.js'