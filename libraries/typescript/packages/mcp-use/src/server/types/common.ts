/**
 * Common type definitions shared across different MCP components
 */

export interface ServerConfig {
  name: string
  version: string
  description?: string
  host?: string // Hostname for widget URLs and server endpoints (defaults to 'localhost')
  baseUrl?: string // Full base URL (e.g., 'https://myserver.com') - overrides host:port for widget URLs
}

export interface InputDefinition {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  required?: boolean
  default?: any
}

/**
 * Annotations provide hints to clients about how to use or display resources
 */
export interface ResourceAnnotations {
  /** Intended audience(s) for this resource */
  audience?: ('user' | 'assistant')[]
  /** Priority from 0.0 (least important) to 1.0 (most important) */
  priority?: number
  /** ISO 8601 formatted timestamp of last modification */
  lastModified?: string
}