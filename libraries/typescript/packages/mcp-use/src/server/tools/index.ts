/**
 * Tool registration utilities
 *
 * This module provides functions for registering tools with the MCP server.
 */

export {
  convertZodSchemaToParams,
  createParamsSchema,
  type InputDefinition,
} from "./schema-helpers.js";

export {
  toolRegistration,
  type ToolServerContext,
} from "./tool-registration.js";

export {
  type SessionData,
  type SessionContextResult,
  type ParsedElicitParams,
  findSessionContext,
  sendProgressNotification,
  withTimeout,
  parseElicitParams,
  createSampleMethod,
  createElicitMethod,
  createReportProgressMethod,
  createEnhancedContext,
} from "./tool-execution-helpers.js";

// Re-export types from the types module for backward compatibility
export type {
  SampleOptions,
  ElicitOptions,
  ElicitFormParams,
  ElicitUrlParams,
} from "../types/index.js";
