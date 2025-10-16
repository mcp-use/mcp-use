import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { InputDefinition } from './common.js'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

export type ToolHandler = (params: Record<string, any>) => Promise<CallToolResult>

export interface ToolDefinition {
  /** Unique identifier for the tool */
  name: string
  /** Description of what the tool does */
  description?: string
  /** Input parameter definitions */
  inputs?: InputDefinition[]
  /** Async function that executes the tool */
  fn: ToolHandler
  /** Tool annotations */
  annotations?: ToolAnnotations
  /** Metadata for the tool */
  metadata?: Record<string, unknown>
}