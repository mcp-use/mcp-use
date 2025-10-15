/**
 * Type definitions for observability module
 */

import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

/**
 * Configuration for Langfuse integration
 */
export interface LangfuseConfig {
  publicKey?: string
  secretKey?: string
  baseUrl?: string
  flushAt?: number
  flushInterval?: number
  release?: string
  requestTimeout?: number
  enabled?: boolean
}

/**
 * Configuration for Laminar integration
 */
export interface LaminarConfig {
  projectApiKey?: string
  baseUrl?: string
}

/**
 * Extended callback handler with shutdown support
 */
export interface ObservabilityCallbackHandler extends BaseCallbackHandler {
  /** Optional shutdown method for cleanup */
  shutdownAsync?: () => Promise<void>
  shutdown?: () => void | Promise<void>
}

/**
 * Observability platform information
 */
export interface ObservabilityPlatform {
  name: string
  handler?: ObservabilityCallbackHandler
  initialized: boolean
  autoInstrumentation?: boolean
}
