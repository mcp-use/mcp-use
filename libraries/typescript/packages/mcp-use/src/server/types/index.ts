/**
 * Centralized type exports for MCP server
 */

// Common types
export {
  ServerConfig,
  InputDefinition,
  ResourceAnnotations,
} from "./common.js";

// Context types
export { McpContext } from "./context.js";

// Tool context types
export {
  ToolContext,
  SampleOptions,
  ElicitOptions,
  ElicitFormParams,
  ElicitUrlParams,
} from "./tool-context.js";

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
  AppsSdkToolMetadata,
} from "./resource.js";

// Tool types
export {
  ToolCallback,
  ToolDefinition,
  InferToolInput,
  InferToolOutput,
  EnhancedToolContext,
} from "./tool.js";

// Prompt types
export { PromptCallback, PromptDefinition } from "./prompt.js";
