/**
 * Prompt templates for MCP code execution mode.
 *
 * This module provides prompt templates to guide agents on how to use
 * MCP tools via code execution.
 */

import { CODE_MODE_AGENT_PROMPT } from "./connectors/codeMode.js";

/**
 * Collection of prompt templates for MCP agents.
 */
export const PROMPTS = {
  CODE_MODE: CODE_MODE_AGENT_PROMPT,
} as const;
