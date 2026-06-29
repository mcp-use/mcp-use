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
export { ClientCapabilityChecker, McpContext } from "./context.js";

export type {
  AuthContext,
  AuthDecision,
  AuthPredicate,
  AuthRequirement,
  AuthRequirementSummary,
  Policy,
  PolicyRequest,
} from "../oauth/types.js";

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
  InferTemplateParams,
  ResourceTemplateCallbacks,
  ResourceTemplateDefinition,
  ResourceDefinition,
  EnhancedResourceContext,
  // UIResource specific types
  UIResourceContent,
  WidgetProps,
  UIEncoding,
  UIResourceDefinition,
  AppsSdkUIResource,
  McpAppsUIResource,
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

export { ToolRef, createToolRef } from "./tool-ref.js";

// Prompt types
export {
  PromptCallback,
  PromptDefinition,
  InferPromptInput,
  EnhancedPromptContext,
  GetPromptResult,
  PromptResult,
} from "./prompt.js";
