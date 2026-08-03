/**
 * Prompt templates for MCP agents.
 *
 * This module provides prompt templates to guide agents on how to use
 * MCP tools, including code execution mode.
 */

// ponytail: CODE_MODE_AGENT_PROMPT may be absent on older @mcp-use/client builds
const CODE_MODE_PROMPT =
  "Use code execution mode to discover and call MCP tools programmatically.";

/**
 * Built-in prompt fragments for agent features.
 *
 * `CODE_MODE` instructs a model to discover and invoke MCP tools through the
 * code execution interface.
 */
export const PROMPTS = {
  /** Instruction used to enable code-based MCP tool discovery and calls. */
  CODE_MODE: CODE_MODE_PROMPT,
} as const;
