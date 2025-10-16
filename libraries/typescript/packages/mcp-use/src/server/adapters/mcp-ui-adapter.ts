/**
 * MCP-UI Adapter Utilities
 *
 * Pure functions to convert mcp-use high-level UIResource definitions
 * into @mcp-ui/server compatible resource objects.
 *
 * Ref: https://mcpui.dev/guide/server/typescript/usage-examples
 * Apps SDK: https://mcpui.dev/guide/apps-sdk
 */

import { createUIResource, type AdaptersConfig } from '@mcp-ui/server'

import type {
  UIResourceContent,
  UIResourceDefinition,
  UIEncoding,
  AppsSdkMetadata
} from '../types/resource.js'

/**
 * Configuration for building widget URLs
 */
export interface UrlConfig {
  baseUrl: string
  port: number | string
}

/**
 * Build the full URL for a widget including query parameters
 *
 * @param widget - Widget identifier
 * @param props - Parameters to pass as query params
 * @param config - URL configuration (baseUrl and port)
 * @returns Complete widget URL with encoded parameters
 */
export function buildWidgetUrl(
  widget: string,
  props: Record<string, any> | undefined,
  config: UrlConfig
): string {
  const url = new URL(
    `/mcp-use/widgets/${widget}`,
    `${config.baseUrl}:${config.port}`
  )

  if (props) {
    Object.entries(props).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        const stringValue = typeof value === 'object'
          ? JSON.stringify(value)
          : String(value)
        url.searchParams.set(key, stringValue)
      }
    })
  }

  return url.toString()
}

/**
 * Create a UIResource for an external URL (iframe)
 *
 * @param uri - Resource URI (must start with ui://)
 * @param iframeUrl - URL to load in iframe
 * @param encoding - Encoding type ('text' or 'blob')
 * @param adapters - Adapter configuration (e.g., Apps SDK)
 * @param metadata - Additional metadata for the resource
 * @returns UIResourceContent object
 */
export function createExternalUrlResource(
  uri: string,
  iframeUrl: string,
  encoding: UIEncoding = 'text',
  adapters?: AdaptersConfig,
  metadata?: AppsSdkMetadata
): UIResourceContent {
  return createUIResource({
    uri: uri as `ui://${string}`,
    content: { type: 'externalUrl', iframeUrl },
    encoding,
    adapters: adapters,
    metadata: metadata,
  })
}

/**
 * Create a UIResource for raw HTML content
 *
 * @param uri - Resource URI (must start with ui://)
 * @param htmlString - HTML content to render
 * @param encoding - Encoding type ('text' or 'blob')
 * @param adapters - Adapter configuration (e.g., Apps SDK)
 * @param metadata - Additional metadata for the resource
 * @returns UIResourceContent object
 */
export function createRawHtmlResource(
  uri: string,
  htmlString: string,
  encoding: UIEncoding = 'text',
  adapters?: AdaptersConfig,
  metadata?: AppsSdkMetadata
): UIResourceContent {
  return createUIResource({
    uri: uri as `ui://${string}`,
    content: { type: 'rawHtml', htmlString },
    encoding,
    adapters: adapters,
    metadata: metadata
  })
}

/**
 * Create a UIResource for Remote DOM scripting
 *
 * @param uri - Resource URI (must start with ui://)
 * @param script - JavaScript code for remote DOM manipulation
 * @param framework - Framework for remote DOM ('react' or 'webcomponents')
 * @param encoding - Encoding type ('text' or 'blob')
 * @param adapters - Adapter configuration (e.g., Apps SDK)
 * @param metadata - Additional metadata for the resource
 * @returns UIResourceContent object
 */
export function createRemoteDomResource(
  uri: string,
  script: string,
  framework: 'react' | 'webcomponents' = 'react',
  encoding: UIEncoding = 'text',
  adapters?: AdaptersConfig,
  metadata?: AppsSdkMetadata
): UIResourceContent {
  return createUIResource({
    uri: uri as `ui://${string}`,
    content: { type: 'remoteDom', script, framework },
    encoding,
    adapters: adapters,
    metadata: metadata
  })
}

/**
 * Create a UIResource from a high-level definition
 *
 * This is the main function that routes to the appropriate resource creator
 * based on the discriminated union type.
 *
 * @param definition - UIResource definition (discriminated union)
 * @param params - Runtime parameters for the widget (for externalUrl type)
 * @param config - URL configuration for building widget URLs
 * @returns UIResourceContent object
 */
export function createUIResourceFromDefinition(
  definition: UIResourceDefinition,
  params: Record<string, any>,
  config: UrlConfig
): UIResourceContent {
  const uri = `ui://widget/${definition.name}` as `ui://${string}`
  const encoding = definition.encoding || 'text'
  const adapters = definition.adapters
  const metadata = definition.appsSdkMetadata

  switch (definition.type) {
    case 'externalUrl': {
      const widgetUrl = buildWidgetUrl(definition.widget, params, config)
      return createExternalUrlResource(uri, widgetUrl, encoding, adapters, metadata)
    }

    case 'rawHtml': {
      return createRawHtmlResource(uri, definition.htmlContent, encoding, adapters, metadata)
    }

    case 'remoteDom': {
      const framework = definition.framework || 'react'
      return createRemoteDomResource(uri, definition.script, framework, encoding, adapters, metadata)
    }

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = definition
      throw new Error(`Unknown UI resource type: ${(_exhaustive as any).type}`)
    }
  }
}

