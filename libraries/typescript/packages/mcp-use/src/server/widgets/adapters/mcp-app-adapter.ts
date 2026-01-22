/**
 * MCP App Protocol Adapter
 *
 * Handles UI resource registration for MCP Apps standard widgets.
 * Uses text/html;profile=mcp-app MIME type and follows the MCP Apps
 * specification for host communication.
 *
 * @see https://github.com/modelcontextprotocol/specification
 */

import type {
  McpAppUIResource,
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
 * MCP App Protocol Adapter
 *
 * Implements the UIResourceProtocolAdapter interface for MCP Apps standard widgets.
 * Handles:
 * - text/html;profile=mcp-app MIME type
 * - CSP configuration for security
 * - ui.resourceUri metadata for tool integration
 */
export class McpAppProtocolAdapter implements UIResourceProtocolAdapter<McpAppUIResource> {
  readonly type = "mcpApp" as const;
  readonly mimeType = "text/html;profile=mcp-app";

  /**
   * Build tool metadata for MCP App widgets
   *
   * Includes ui.resourceUri as required by MCP Apps spec.
   */
  buildToolMeta(
    def: UIResourceDefinition,
    _serverConfig: AdapterServerConfig
  ): Record<string, unknown> {
    const definition = def as McpAppUIResource;
    const resourceUri = this.generateResourceUri(definition);
    const toolMetadata: Record<string, unknown> = definition._meta || {};

    // Add ui.resourceUri for MCP Apps spec compliance
    toolMetadata["ui"] = {
      resourceUri: resourceUri,
    };

    return toolMetadata;
  }

  /**
   * Build UI resource metadata for storage in widgetDefinitions
   *
   * Includes contentHash if available for version identification.
   */
  buildUIResourceMeta(
    def: UIResourceDefinition,
    _serverConfig: AdapterServerConfig
  ): UIResourceMeta {
    const definition = def as McpAppUIResource;
    const widgetMeta = definition._meta?.["mcp-use/widget"] as
      | { contentHash?: string }
      | undefined;

    if (definition._meta) {
      return {
        ...definition._meta,
        "mcp-use/widgetType": this.type,
        // Include contentHash at top level for version identification
        "mcp-use/contentHash": widgetMeta?.contentHash,
      };
    }
    return {
      "mcp-use/widgetType": this.type,
    };
  }

  /**
   * Register resources and templates for MCP App widgets
   *
   * Registers:
   * 1. Static resource (main widget)
   * 2. Resource template (for dynamic URIs)
   */
  registerResources(
    server: UIResourceServer,
    def: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): void {
    const definition = def as McpAppUIResource;
    const resourceUri = this.generateResourceUri(
      definition,
      serverConfig.buildId
    );
    const widgetServerConfig = this.toWidgetServerConfig(serverConfig);
    const mcpAppMeta = this.buildMcpAppMeta(definition, serverConfig);

    // 1. Register the main static resource
    server.resource({
      name: definition.name,
      uri: resourceUri,
      title: definition.title,
      description: definition.description,
      mimeType: this.mimeType,
      _meta: mcpAppMeta,
      annotations: definition.annotations,
      readCallback: async () => {
        const uiResource = await createWidgetUIResource(
          definition,
          {},
          widgetServerConfig,
          "mcp-app"
        );
        uiResource.resource.uri = resourceUri;
        uiResource.resource.mimeType = this.mimeType;
        return { contents: [uiResource.resource] };
      },
    });

    // 2. Register dynamic template for MCP App
    const buildIdPart = serverConfig.buildId ? `-${serverConfig.buildId}` : "";
    const mcpAppUriTemplate = `ui://widget/${definition.name}${buildIdPart}-{id}-mcp.html`;

    server.resourceTemplate({
      name: `${definition.name}-dynamic`,
      resourceTemplate: {
        uriTemplate: mcpAppUriTemplate,
        name: definition.title || definition.name,
        description: definition.description,
        mimeType: this.mimeType,
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
        uiResource.resource.mimeType = this.mimeType;
        return { contents: [uiResource.resource] };
      },
    });
  }

  /**
   * Build MCP App metadata with CSP configuration
   */
  private buildMcpAppMeta(
    def: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): Record<string, unknown> {
    const definition = def as McpAppUIResource;
    const serverOrigin =
      serverConfig.serverBaseUrl ||
      `http://${serverConfig.serverHost}:${serverConfig.serverPort}`;

    const defaultCsp = {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", serverOrigin],
      "style-src": ["'self'", "'unsafe-inline'", serverOrigin],
      "connect-src": ["'self'", serverOrigin],
      "img-src": ["'self'", "data:", serverOrigin],
      "font-src": ["'self'", serverOrigin],
    };

    return {
      ...definition._meta,
      ui: {
        csp: definition.mcpAppMetadata?.csp || defaultCsp,
      },
    };
  }

  /**
   * Build tool response for MCP App widgets
   *
   * Returns text content + structuredContent with _meta.ui.resourceUri.
   * Per MCP Apps spec: tools reference pre-declared resources.
   */
  async buildToolResponse(
    def: UIResourceDefinition,
    params: Record<string, unknown>,
    _serverConfig: AdapterServerConfig
  ): Promise<AdapterToolResponse> {
    const definition = def as McpAppUIResource;
    const displayName = definition.title || definition.name;

    // Use static URI matching the registered resource (no random ID for mcpApp)
    const staticUri = generateWidgetUri(definition.name, undefined, ".html");

    // Generate tool output content (what the model sees - text only)
    let textContent = `Displaying ${displayName}`;

    if (definition.toolOutput) {
      const toolOutputResult =
        typeof definition.toolOutput === "function"
          ? definition.toolOutput(params)
          : definition.toolOutput;
      if (toolOutputResult.content && Array.isArray(toolOutputResult.content)) {
        // Extract text from custom toolOutput
        const textItem = toolOutputResult.content.find(
          (c: any) => c.type === "text"
        );
        if (textItem && "text" in textItem) {
          textContent = textItem.text as string;
        }
      }
    }

    // Return MCP Apps compliant response
    return {
      _meta: {
        "mcp-use/props": params,
        ui: {
          resourceUri: staticUri,
        },
      },
      content: [{ type: "text" as const, text: textContent }],
      structuredContent: params,
    };
  }

  /**
   * Generate resource URI for MCP App widgets
   */
  generateResourceUri(def: UIResourceDefinition, _buildId?: string): string {
    const definition = def as McpAppUIResource;
    // MCP App doesn't use buildId in URI
    return generateWidgetUri(definition.name, undefined, ".html");
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
 * Singleton instance of the MCP App adapter
 */
export const mcpAppAdapter = new McpAppProtocolAdapter();
