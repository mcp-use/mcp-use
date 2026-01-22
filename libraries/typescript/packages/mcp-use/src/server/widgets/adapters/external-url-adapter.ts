/**
 * External URL Protocol Adapter
 *
 * Handles UI resource registration for legacy MCP-UI iframe-based widgets.
 * Uses text/uri-list MIME type for external URL references.
 */

import type {
  ExternalUrlUIResource,
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
  applyDefaultProps,
  createWidgetUIResource,
  type WidgetServerConfig,
} from "../widget-helpers.js";

/**
 * External URL Protocol Adapter
 *
 * Implements the UIResourceProtocolAdapter interface for legacy MCP-UI
 * iframe-based widgets. These widgets are loaded via external URL.
 */
export class ExternalUrlProtocolAdapter implements UIResourceProtocolAdapter<ExternalUrlUIResource> {
  readonly type = "externalUrl" as const;
  readonly mimeType = "text/uri-list";

  /**
   * Build tool metadata for External URL widgets
   *
   * Returns basic metadata without protocol-specific fields.
   */
  buildToolMeta(
    def: UIResourceDefinition,
    _serverConfig: AdapterServerConfig
  ): Record<string, unknown> {
    const definition = def as ExternalUrlUIResource;
    return definition._meta || {};
  }

  /**
   * Build UI resource metadata for storage in widgetDefinitions
   */
  buildUIResourceMeta(
    def: UIResourceDefinition,
    _serverConfig: AdapterServerConfig
  ): UIResourceMeta {
    const definition = def as ExternalUrlUIResource;
    return {
      ...definition._meta,
      "mcp-use/widgetType": this.type,
    };
  }

  /**
   * Register resources for External URL widgets
   *
   * Registers only a static resource (no templates).
   */
  registerResources(
    server: UIResourceServer,
    def: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): void {
    const definition = def as ExternalUrlUIResource;
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
        // For externalUrl type, use default props
        const params = applyDefaultProps(definition.props);
        const uiResource = await createWidgetUIResource(
          definition,
          params,
          widgetServerConfig
        );
        uiResource.resource.uri = resourceUri;
        return { contents: [uiResource.resource] };
      },
    });
  }

  /**
   * Build tool response for External URL widgets
   *
   * Returns standard response with embedded UIResource.
   */
  async buildToolResponse(
    def: UIResourceDefinition,
    params: Record<string, unknown>,
    serverConfig: AdapterServerConfig
  ): Promise<AdapterToolResponse> {
    const definition = def as ExternalUrlUIResource;
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
   * Generate resource URI for External URL widgets
   */
  generateResourceUri(def: UIResourceDefinition, buildId?: string): string {
    const definition = def as ExternalUrlUIResource;
    return generateWidgetUri(definition.widget, buildId);
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
 * Singleton instance of the External URL adapter
 */
export const externalUrlAdapter = new ExternalUrlProtocolAdapter();
