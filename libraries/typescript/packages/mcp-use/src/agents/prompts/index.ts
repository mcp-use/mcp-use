/**
 * Prompt templates for MCP agents.
 *
 * This module provides prompt templates to guide agents on how to use
 * MCP tools, including code execution mode.
 */

import { CODE_MODE_AGENT_PROMPT } from "../../client/connectors/codeMode.js";

/**
 * Collection of prompt templates for MCP agents.
 */
export const PROMPTS = {
  CODE_MODE: CODE_MODE_AGENT_PROMPT,
} as const;
