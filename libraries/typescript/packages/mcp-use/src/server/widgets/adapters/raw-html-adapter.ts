/**
 * Raw HTML Protocol Adapter
 *
 * Handles UI resource registration for legacy MCP-UI raw HTML widgets.
 * Uses text/html MIME type for direct HTML content.
 */

import type {
  RawHtmlUIResource,
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
 * Raw HTML Protocol Adapter
 *
 * Implements the UIResourceProtocolAdapter interface for legacy MCP-UI
 * raw HTML widgets. These widgets render HTML content directly.
 */
export class RawHtmlProtocolAdapter implements UIResourceProtocolAdapter<RawHtmlUIResource> {
  readonly type = "rawHtml" as const;
  readonly mimeType = "text/html";

  /**
   * Build tool metadata for Raw HTML widgets
   *
   * Returns basic metadata without protocol-specific fields.
   */
  buildToolMeta(
    def: UIResourceDefinition,
    _serverConfig: AdapterServerConfig
  ): Record<string, unknown> {
    const definition = def as RawHtmlUIResource;
    return definition._meta || {};
  }

  /**
   * Build UI resource metadata for storage in widgetDefinitions
   */
  buildUIResourceMeta(
    def: UIResourceDefinition,
    _serverConfig: AdapterServerConfig
  ): UIResourceMeta {
    const definition = def as RawHtmlUIResource;
    return {
      ...definition._meta,
      "mcp-use/widgetType": this.type,
    };
  }

  /**
   * Register resources for Raw HTML widgets
   *
   * Registers only a static resource (no templates).
   */
  registerResources(
    server: UIResourceServer,
    def: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): void {
    const definition = def as RawHtmlUIResource;
    const resourceUri = this.generateResourceUri(
      definition,
      serverConfig.buildId
    );
    const widgetServerConfig = this.toWidgetServerConfig(serverConfig);

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
  }

  /**
   * Build tool response for Raw HTML widgets
   *
   * Returns standard response with embedded UIResource.
   */
  async buildToolResponse(
    def: UIResourceDefinition,
    params: Record<string, unknown>,
    serverConfig: AdapterServerConfig
  ): Promise<AdapterToolResponse> {
    const definition = def as RawHtmlUIResource;
    const displayName = definition.title || definition.name;
    const widgetServerConfig = this.toWidgetServerConfig(serverConfig);

    const uiResource = await createWidgetUIResource(
      definition,
      params,
      widgetServerConfig
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `Displaying ${displayName}`,
        },
        uiResource as any,
      ],
    };
  }

  /**
   * Generate resource URI for Raw HTML widgets
   */
  generateResourceUri(def: UIResourceDefinition, buildId?: string): string {
    const definition = def as RawHtmlUIResource;
    return generateWidgetUri(definition.name, buildId);
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
 * Singleton instance of the Raw HTML adapter
 */
export const rawHtmlAdapter = new RawHtmlProtocolAdapter();
