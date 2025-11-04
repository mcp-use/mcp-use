/**
 * MCP-UI Adapter Utilities
 *
 * Pure functions to convert mcp-use high-level UIResource definitions
 * into @mcp-ui/server compatible resource objects.
 *
 * Ref: https://mcpui.dev/guide/server/typescript/usage-examples
 * Apps SDK: https://mcpui.dev/guide/apps-sdk
 * Official Apps SDK Docs: https://developers.openai.com/apps-sdk/build/mcp-server
 */

import { createUIResource, type AdaptersConfig } from "@mcp-ui/server";

import type {
  UIResourceContent,
  UIResourceDefinition,
  UIEncoding,
  AppsSdkMetadata,
} from "../types/resource.js";

/**
 * Configuration for building widget URLs
 */
export interface UrlConfig {
  baseUrl: string;
  port: number | string;
}

/**
 * Build the full URL for a widget including query parameters
 *
 * @param widget - Widget identifier
 * @param props - Parameters to pass as a single JSON-encoded props param
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
  );

  // Pass all props as a single JSON-encoded parameter
  if (props && Object.keys(props).length > 0) {
    url.searchParams.set("props", JSON.stringify(props));
  }

  return url.toString();
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
  encoding: UIEncoding = "text",
  adapters?: AdaptersConfig,
  metadata?: AppsSdkMetadata
): UIResourceContent {
  return createUIResource({
    uri: uri as `ui://${string}`,
    content: { type: "externalUrl", iframeUrl },
    encoding,
    adapters: adapters,
    metadata: metadata,
  });
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
  encoding: UIEncoding = "text",
  adapters?: AdaptersConfig,
  metadata?: AppsSdkMetadata
): UIResourceContent {
  return createUIResource({
    uri: uri as `ui://${string}`,
    content: { type: "rawHtml", htmlString },
    encoding,
    adapters: adapters,
    metadata: metadata,
  });
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
  framework: "react" | "webcomponents" = "react",
  encoding: UIEncoding = "text",
  adapters?: AdaptersConfig,
  metadata?: AppsSdkMetadata
): UIResourceContent {
  return createUIResource({
    uri: uri as `ui://${string}`,
    content: { type: "remoteDom", script, framework },
    encoding,
    adapters: adapters,
    metadata: metadata,
  });
}

/**
 * Create a UIResource for OpenAI Apps SDK
 *
 * This creates a resource compatible with OpenAI's Apps SDK using the
 * text/html+skybridge mime type. The HTML template should contain the
 * component code with embedded JS/CSS.
 *
 * The Apps SDK pattern:
 * - Uses mime type text/html+skybridge
 * - Tool's structuredContent gets injected as window.openai.toolOutput
 * - Supports Apps SDK metadata (CSP, widget domain, description, etc.)
 *
 * @param uri - Resource URI (must start with ui://)
 * @param htmlTemplate - HTML template with embedded component code
 * @param metadata - Apps SDK metadata (CSP, description, domain, etc.)
 * @returns UIResourceContent object
 *
 * @see https://developers.openai.com/apps-sdk/build/mcp-server
 * @see https://mcpui.dev/guide/apps-sdk
 *
 * @example
 * ```typescript
 * const resource = createAppsSdkResource(
 *   'ui://widget/kanban-board.html',
 *   `
 *     <div id="kanban-root"></div>
 *     <style>${kanbanCSS}</style>
 *     <script type="module">${kanbanJS}</script>
 *   `,
 *   {
 *     'openai/widgetDescription': 'Displays an interactive kanban board',
 *     'openai/widgetCSP': {
 *       connect_domains: [],
 *       resource_domains: ['https://cdn.example.com']
 *     },
 *     'openai/widgetPrefersBorder': true
 *   }
 * )
 * ```
 */
export function createAppsSdkResource(
  uri: string,
  htmlTemplate: string,
  metadata?: AppsSdkMetadata
): UIResourceContent {
  // For Apps SDK, we create the resource structure manually following the official pattern
  // from https://developers.openai.com/apps-sdk/build/mcp-server
  const resource: any = {
    uri,
    mimeType: "text/html+skybridge",
    text: htmlTemplate,
  };

  // Add metadata if provided
  if (metadata && Object.keys(metadata).length > 0) {
    resource._meta = metadata;
  }

  return {
    type: "resource",
    resource,
  };
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
  // For Apps SDK, use .html extension following the convention
  const uri =
    definition.type === "appsSdk"
      ? (`ui://widget/${definition.name}.html` as `ui://${string}`)
      : (`ui://widget/${definition.name}` as `ui://${string}`);
  const encoding = definition.encoding || "text";

  switch (definition.type) {
    case "externalUrl": {
      const widgetUrl = buildWidgetUrl(definition.widget, params, config);
      return createExternalUrlResource(
        uri,
        widgetUrl,
        encoding,
        definition.adapters,
        definition.appsSdkMetadata
      );
    }

    case "rawHtml": {
      return createRawHtmlResource(
        uri,
        definition.htmlContent,
        encoding,
        definition.adapters,
        definition.appsSdkMetadata
      );
    }

    case "remoteDom": {
      const framework = definition.framework || "react";
      return createRemoteDomResource(
        uri,
        definition.script,
        framework,
        encoding,
        definition.adapters,
        definition.appsSdkMetadata
      );
    }

    case "appsSdk": {
      return createAppsSdkResource(
        uri,
        definition.htmlTemplate,
        definition.appsSdkMetadata
      );
    }

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = definition;
      throw new Error(`Unknown UI resource type: ${(_exhaustive as any).type}`);
    }
  }
}
