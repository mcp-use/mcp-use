/**
 * Observability module for MCP-use.
 *
 * This module provides centralized observability management for LangChain agents,
 * supporting multiple platforms like Langfuse and Laminar.
 */

// Import observability providers - order matters for initialization
import "./langfuse.js";

// Re-export individual handlers for direct usage if needed
export {
  langfuseClient,
  langfuseHandler,
  langfuseInitPromise,
} from "./langfuse.js";

// Export the manager and its utilities
export {
  createManager,
  getDefaultManager,
  type ObservabilityConfig,
  ObservabilityManager,
} from "./manager.js";
