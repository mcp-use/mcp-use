import type { GetPromptResult, GetPromptRequest } from '@modelcontextprotocol/sdk/types.js'
import type { InputDefinition } from './common.js'

export type PromptCallback = (params: GetPromptRequest) => Promise<GetPromptResult>

export interface PromptDefinition {
  /** Unique identifier for the prompt */
  name: string
  /** Human-readable title for the prompt */
  title?: string
  /** Description of what the prompt does */
  description?: string
  /** Argument definitions */
  args?: InputDefinition[]
  /** Async callback function that generates the prompt */
  cb: PromptCallback
}