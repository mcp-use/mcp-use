/**
 * Apps SDK Protocol Adapter
 *
 * Handles UI resource registration for OpenAI Apps SDK widgets.
 * Uses text/html+skybridge MIME type and supports dual registration
 * for both Apps SDK and MCP App hosts.
 *
 * @see https://developers.openai.com/apps-sdk/build/mcp-server
 */

import type {
  AppsSdkUIResource,
  UIResourceDefinition,
} from "../../types/index.js";
import type { UIResourceServer } from "../ui-resource-registration.js";
import type {
  UIResourceProtocolAdapter,
  AdapterServerConfig,
  UIResourceMeta,
  AdapterToolResponse,
} from "./types.js";
import {
  generateWidgetUri,
  createWidgetUIResource,
  type WidgetServerConfig,
} from "../widget-helpers.js";

/**
 * Apps SDK Protocol Adapter
 *
 * Implements the UIResourceProtocolAdapter interface for OpenAI Apps SDK widgets.
 * Handles:
 * - text/html+skybridge MIME type
 * - Dual registration (Apps SDK + MCP App)
 * - Dynamic URI generation with random IDs
 * - OpenAI-specific tool metadata
 */
export class AppsSdkProtocolAdapter implements UIResourceProtocolAdapter<AppsSdkUIResource> {
  readonly type = "appsSdk" as const;
  readonly mimeType = "text/html+skybridge";

  /**
   * Build tool metadata for Apps SDK widgets
   *
   * Includes OpenAI-specific fields like outputTemplate and invocation status.
   */
  buildToolMeta(
    def: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): Record<string, unknown> {
    const definition = def as AppsSdkUIResource;
    const resourceUri = this.generateResourceUri(
      definition,
      serverConfig.buildId
    );
    const toolMetadata: Record<string, unknown> = definition._meta || {};

    // Add Apps SDK tool metadata
    toolMetadata["openai/outputTemplate"] = resourceUri;

    // Copy over tool-relevant metadata fields from appsSdkMetadata
    if (definition.appsSdkMetadata) {
      const toolMetadataFields = [
        "openai/toolInvocation/invoking",
        "openai/toolInvocation/invoked",
        "openai/widgetAccessible",
        "openai/resultCanProduceWidget",
      ] as const;

      for (const field of toolMetadataFields) {
        if (definition.appsSdkMetadata[field] !== undefined) {
          toolMetadata[field] = definition.appsSdkMetadata[field];
        }
      }
    }

    return toolMetadata;
  }

  /**
   * Build UI resource metadata for storage in widgetDefinitions
   *
   * Includes contentHash if available for deterministic URI generation.
   */
  buildUIResourceMeta(
    def: UIResourceDefinition,
    _serverConfig: AdapterServerConfig
  ): UIResourceMeta {
    const definition = def as AppsSdkUIResource;
    const widgetMeta = definition._meta?.["mcp-use/widget"] as
      | { contentHash?: string }
      | undefined;

    if (definition._meta) {
      return {
        ...definition._meta,
        "mcp-use/widgetType": this.type,
        // Include contentHash at top level for easy access during tool invocation
        "mcp-use/contentHash": widgetMeta?.contentHash,
      };
    }
    return {
      "mcp-use/widgetType": this.type,
    };
  }

  /**
   * Register resources and templates for Apps SDK widgets
   *
   * Registers:
   * 1. Static resource (main widget)
   * 2. Resource template (for dynamic URIs with random IDs)
   * 3. MCP App resource (dual registration for compatibility)
   * 4. MCP App resource template (dual registration)
   */
  registerResources(
    server: UIResourceServer,
    def: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): void {
    const definition = def as AppsSdkUIResource;
    const resourceUri = this.generateResourceUri(
      definition,
      serverConfig.buildId
    );
    const widgetServerConfig = this.toWidgetServerConfig(serverConfig);

    // 1. Register the main static resource
    server.resource({
      name: definition.name,
      uri: resourceUri,
      title: definition.title,
      description: definition.description,
      mimeType: this.mimeType,
      _meta: definition._meta,
      annotations: definition.annotations,
      readCallback: async () => {
        const uiResource = await createWidgetUIResource(
          definition,
          {},
          widgetServerConfig
        );
        uiResource.resource.uri = resourceUri;
        return { contents: [uiResource.resource] };
      },
    });

    // 2. Register resource template for dynamic URIs
    const buildIdPart = serverConfig.buildId ? `-${serverConfig.buildId}` : "";
    const uriTemplate = `ui://widget/${definition.name}${buildIdPart}-{id}.html`;

    server.resourceTemplate({
      name: `${definition.name}-dynamic`,
      resourceTemplate: {
        uriTemplate,
        name: definition.title || definition.name,
        description: definition.description,
        mimeType: this.mimeType,
      },
      _meta: definition._meta,
      title: definition.title,
      description: definition.description,
      annotations: definition.annotations,
      readCallback: async (uri: URL, _params: Record<string, string>) => {
        const uiResource = await createWidgetUIResource(
          definition,
          {},
          widgetServerConfig
        );
        uiResource.resource.uri = uri.toString();
        return { contents: [uiResource.resource] };
      },
    });

    // 3. DUAL REGISTRATION: Register MCP App resource for compatibility
    this.registerMcpAppDualResources(server, definition, serverConfig);
  }

  /**
   * Register dual MCP App resources for Apps SDK widgets
   *
   * This allows the same widget to work with both OpenAI Apps SDK
   * and MCP Apps compliant hosts.
   */
  private registerMcpAppDualResources(
    server: UIResourceServer,
    definition: AppsSdkUIResource,
    serverConfig: AdapterServerConfig
  ): void {
    const mcpAppUri = generateWidgetUri(
      definition.name,
      serverConfig.buildId,
      "-mcp.html"
    );
    const mcpAppMimeType = "text/html;profile=mcp-app";
    const widgetServerConfig = this.toWidgetServerConfig(serverConfig);

    // Build MCP App specific metadata with CSP
    const serverOrigin =
      serverConfig.serverBaseUrl ||
      `http://${serverConfig.serverHost}:${serverConfig.serverPort}`;

    const mcpAppMeta: Record<string, unknown> = {
      ...definition._meta,
      ui: {
        csp: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "'unsafe-inline'", serverOrigin],
          "style-src": ["'self'", "'unsafe-inline'", serverOrigin],
          "connect-src": ["'self'", serverOrigin],
          "img-src": ["'self'", "data:", serverOrigin],
          "font-src": ["'self'", serverOrigin],
        },
      },
    };

    // Register MCP App static resource
    server.resource({
      name: `${definition.name}-mcp-app`,
      uri: mcpAppUri,
      title: definition.title,
      description: definition.description,
      mimeType: mcpAppMimeType,
      _meta: mcpAppMeta,
      annotations: definition.annotations,
      readCallback: async () => {
        const uiResource = await createWidgetUIResource(
          definition,
          {},
          widgetServerConfig,
          "mcp-app"
        );
        uiResource.resource.uri = mcpAppUri;
        uiResource.resource.mimeType = mcpAppMimeType;
        return { contents: [uiResource.resource] };
      },
    });

    // Register MCP App dynamic template
    const buildIdPart = serverConfig.buildId ? `-${serverConfig.buildId}` : "";
    const mcpAppUriTemplate = `ui://widget/${definition.name}${buildIdPart}-{id}-mcp.html`;

    server.resourceTemplate({
      name: `${definition.name}-mcp-app-dynamic`,
      resourceTemplate: {
        uriTemplate: mcpAppUriTemplate,
        name: definition.title || definition.name,
        description: definition.description,
        mimeType: mcpAppMimeType,
      },
      _meta: mcpAppMeta,
      title: definition.title,
      description: definition.description,
      annotations: definition.annotations,
      readCallback: async (uri: URL, _params: Record<string, string>) => {
        const uiResource = await createWidgetUIResource(
          definition,
          {},
          widgetServerConfig,
          "mcp-app"
        );
        uiResource.resource.uri = uri.toString();
        uiResource.resource.mimeType = mcpAppMimeType;
        return { contents: [uiResource.resource] };
      },
    });
  }

  /**
   * Build tool response for Apps SDK widgets
   *
   * Returns _meta with unique URI and widget props, plus text content.
   * Uses content hash for deterministic URIs when available, enabling proper caching.
   */
  async buildToolResponse(
    def: UIResourceDefinition,
    params: Record<string, unknown>,
    serverConfig: AdapterServerConfig
  ): Promise<AdapterToolResponse> {
    const definition = def as AppsSdkUIResource;
    const displayName = definition.title || definition.name;
    const toolMetadata = this.buildToolMeta(definition, serverConfig);

    // Use content hash for deterministic URI (enables caching)
    // Falls back to random ID if hash not available (backward compatibility)
    const widgetMeta = definition._meta?.["mcp-use/widget"] as
      | { contentHash?: string }
      | undefined;
    const uriSuffix =
      widgetMeta?.contentHash || Math.random().toString(36).substring(2, 15);
    const uniqueUri = generateWidgetUri(
      definition.name,
      serverConfig.buildId,
      ".html",
      uriSuffix
    );

    // Update toolMetadata with the unique URI and widget props
    const uniqueToolMetadata = {
      ...toolMetadata,
      "openai/outputTemplate": uniqueUri,
      "mcp-use/props": params,
    };

    // Generate tool output (what the model sees)
    let toolOutputResult;
    if (definition.toolOutput) {
      toolOutputResult =
        typeof definition.toolOutput === "function"
          ? definition.toolOutput(params)
          : definition.toolOutput;
    } else {
      toolOutputResult = {
        content: [
          {
            type: "text" as const,
            text: `Displaying ${displayName}`,
          },
        ],
      };
    }

    // Ensure content exists (required by CallToolResult)
    const content =
      (toolOutputResult.content as AdapterToolResponse["content"]) || [
        { type: "text" as const, text: `Displaying ${displayName}` },
      ];

    return {
      _meta: uniqueToolMetadata,
      content,
      structuredContent: toolOutputResult.structuredContent,
    };
  }

  /**
   * Generate resource URI for Apps SDK widgets
   */
  generateResourceUri(def: UIResourceDefinition, buildId?: string): string {
    const definition = def as AppsSdkUIResource;
    return generateWidgetUri(definition.name, buildId, ".html");
  }

  /**
   * Convert AdapterServerConfig to WidgetServerConfig
   */
  private toWidgetServerConfig(
    serverConfig: AdapterServerConfig
  ): WidgetServerConfig {
    return {
      serverHost: serverConfig.serverHost,
      serverPort: serverConfig.serverPort,
      serverBaseUrl: serverConfig.serverBaseUrl,
      buildId: serverConfig.buildId,
    };
  }
}

/**
 * Singleton instance of the Apps SDK adapter
 */
export const appsSdkAdapter = new AppsSdkProtocolAdapter();
