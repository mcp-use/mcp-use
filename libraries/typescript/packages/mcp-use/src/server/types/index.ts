/**
 * Centralized type exports for MCP server
 */

// Common types
export {
  ServerConfig,
  InputDefinition,
  ResourceAnnotations,
  OptionalizeUndefinedFields,
  InferZodInput,
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
  ResourceTemplateDefinitionWithoutCallback,
  FlatResourceTemplateDefinition,
  FlatResourceTemplateDefinitionWithoutCallback,
  ResourceDefinition,
  ResourceDefinitionWithoutCallback,
  EnhancedResourceContext,
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
  ToolCallbackWithContext,
  ToolDefinition,
  InferToolInput,
  InferToolOutput,
  EnhancedToolContext,
  ToolAnnotations,
} from "./tool.js";

// Prompt types
export {
  PromptCallback,
  PromptDefinition,
  PromptDefinitionWithoutCallback,
  InferPromptInput,
  EnhancedPromptContext,
  GetPromptResult,
} from "./prompt.js";
