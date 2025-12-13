/**
 * UI Resource Registration
 *
 * This module handles the registration of UI widgets as both tools and resources
 * in the MCP server. It creates a unified interface for MCP-UI compatible widgets.
 */

import type {
  UIResourceDefinition,
  ResourceDefinition,
  ResourceDefinitionWithoutCallback,
  ResourceTemplateDefinition,
  ResourceTemplateDefinitionWithoutCallback,
  FlatResourceTemplateDefinition,
  FlatResourceTemplateDefinitionWithoutCallback,
  ToolDefinition,
} from "../types/index.js";
import {
  generateWidgetUri,
  convertPropsToInputs,
  applyDefaultProps,
  createWidgetUIResource,
  type WidgetServerConfig,
} from "./widget-helpers.js";

/**
 * Minimal server interface for UI resource registration
 *
 * This interface defines the minimal contract needed by uiResourceRegistration.
 * It uses broad types to be compatible with the various wrapped method signatures
 * in MCPServer while still providing type safety at the call sites.
 */
export interface UIResourceServer {
  readonly buildId?: string;
  readonly serverHost: string;
  readonly serverPort?: number;
  readonly serverBaseUrl?: string;
  /** Storage for widget definitions, used to inject metadata into tool responses */
  widgetDefinitions: Map<string, Record<string, unknown>>;
  resource: (
    definition: ResourceDefinition | ResourceDefinitionWithoutCallback,
    callback?: any
  ) => any;
  resourceTemplate: (
    definition:
      | ResourceTemplateDefinition
      | ResourceTemplateDefinitionWithoutCallback
      | FlatResourceTemplateDefinition
      | FlatResourceTemplateDefinitionWithoutCallback,
    callback?: any
  ) => any;
  tool: (definition: ToolDefinition, callback?: any) => any;
}

/**
 * Register a UI widget as both a tool and a resource
 *
 * Creates a unified interface for MCP-UI compatible widgets that can be accessed
 * either as tools (with parameters) or as resources (static access). The tool
 * allows dynamic parameter passing while the resource provides discoverable access.
 *
 * Supports multiple UI resource types:
 * - externalUrl: Legacy MCP-UI iframe-based widgets
 * - rawHtml: Legacy MCP-UI raw HTML content
 * - remoteDom: Legacy MCP-UI Remote DOM scripting
 * - appsSdk: OpenAI Apps SDK compatible widgets (text/html+skybridge)
 *
 * @param server - MCPServer instance with registration methods
 * @param definition - Widget configuration object
 * @param definition.name - Unique identifier for the resource
 * @param definition.type - Type of UI resource (externalUrl, rawHtml, remoteDom, appsSdk)
 * @param definition.title - Human-readable title for the widget
 * @param definition.description - Description of the widget's functionality
 * @param definition.props - Widget properties configuration with types and defaults
 * @param definition.size - Preferred iframe size [width, height] (e.g., ['900px', '600px'])
 * @param definition.annotations - Resource annotations for discovery
 * @param definition.appsSdkMetadata - Apps SDK specific metadata (CSP, widget description, etc.)
 *
 * @example
 * ```typescript
 * server.uiResource({
 *   type: 'appsSdk',
 *   name: 'kanban-board',
 *   title: 'Kanban Board',
 *   description: 'Interactive task management board',
 *   htmlTemplate: '<div>...</div>',
 *   appsSdkMetadata: { ... }
 * })
 * ```
 */
export function uiResourceRegistration<T extends UIResourceServer>(
  server: T,
  definition: UIResourceDefinition
): T {
  const displayName = definition.title || definition.name;

  // Store widget definition for use by tools with returnsWidget option
  if (definition.type === "appsSdk" && definition._meta) {
    server.widgetDefinitions.set(
      definition.name,
      definition._meta as Record<string, unknown>
    );
  }

  // Determine resource URI and mimeType based on type
  let resourceUri: string;
  let mimeType: string;

  switch (definition.type) {
    case "externalUrl":
      resourceUri = generateWidgetUri(definition.widget, server.buildId);
      mimeType = "text/uri-list";
      break;
    case "rawHtml":
      resourceUri = generateWidgetUri(definition.name, server.buildId);
      mimeType = "text/html";
      break;
    case "remoteDom":
      resourceUri = generateWidgetUri(definition.name, server.buildId);
      mimeType = "application/vnd.mcp-ui.remote-dom+javascript";
      break;
    case "appsSdk":
      resourceUri = generateWidgetUri(definition.name, server.buildId, ".html");
      mimeType = "text/html+skybridge";
      break;
    default:
      throw new Error(
        `Unsupported UI resource type. Must be one of: externalUrl, rawHtml, remoteDom, appsSdk`
      );
  }

  // Create server config for widget UI resource creation
  const serverConfig: WidgetServerConfig = {
    serverHost: server.serverHost,
    serverPort: server.serverPort || 3000,
    serverBaseUrl: server.serverBaseUrl,
    buildId: server.buildId,
  };

  // Register the resource
  server.resource({
    name: definition.name,
    uri: resourceUri,
    title: definition.title,
    description: definition.description,
    mimeType,
    _meta: definition._meta,
    annotations: definition.annotations,
    readCallback: async () => {
      // For externalUrl type, use default props. For others, use empty params
      const params =
        definition.type === "externalUrl"
          ? applyDefaultProps(definition.props)
          : {};

      const uiResource = await createWidgetUIResource(
        definition,
        params,
        serverConfig
      );

      // Ensure the resource content URI matches the registered URI (with build ID)
      uiResource.resource.uri = resourceUri;

      return {
        contents: [uiResource.resource],
      };
    },
  });

  // For Apps SDK, also register a resource template to handle dynamic URIs with random IDs
  if (definition.type === "appsSdk") {
    // Build URI template with build ID if available
    const buildIdPart = server.buildId ? `-${server.buildId}` : "";
    const uriTemplate = `ui://widget/${definition.name}${buildIdPart}-{id}.html`;

    server.resourceTemplate({
      name: `${definition.name}-dynamic`,
      resourceTemplate: {
        uriTemplate,
        name: definition.title || definition.name,
        description: definition.description,
        mimeType,
      },
      _meta: definition._meta,
      title: definition.title,
      description: definition.description,
      annotations: definition.annotations,
      readCallback: async (uri: URL, params: Record<string, string>) => {
        // Use empty params for Apps SDK since structuredContent is passed separately
        const uiResource = await createWidgetUIResource(
          definition,
          {},
          serverConfig
        );

        // Ensure the resource content URI matches the template URI (with build ID)
        uiResource.resource.uri = uri.toString();

        return {
          contents: [uiResource.resource],
        };
      },
    });
  }

  // Check if tool should be registered (defaults to true for backward compatibility)
  // Check direct property first (from programmatic API), then fall back to _meta (from file-based widgets)
  const widgetMetadata = definition._meta?.["mcp-use/widget"] as
    | { exposeAsTool?: boolean }
    | undefined;
  const exposeAsTool =
    definition.exposeAsTool ?? widgetMetadata?.exposeAsTool ?? true;

  // Register the tool only if exposeAsTool is not false
  // Note: Resources and resource templates are always registered regardless of exposeAsTool
  // because custom tools may reference them via the widget() helper
  if (exposeAsTool) {
    // For Apps SDK, include the outputTemplate metadata
    const toolMetadata: Record<string, unknown> = definition._meta || {};

    if (definition.type === "appsSdk" && definition.appsSdkMetadata) {
      // Add Apps SDK tool metadata
      toolMetadata["openai/outputTemplate"] = resourceUri;

      // Copy over tool-relevant metadata fields from appsSdkMetadata
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

    server.tool(
      {
        name: definition.name,
        title: definition.title,
        description: definition.description,
        inputs: convertPropsToInputs(definition.props),
        annotations: definition.toolAnnotations,
        _meta: Object.keys(toolMetadata).length > 0 ? toolMetadata : undefined,
      },
      async (params: Record<string, unknown>) => {
        // Create the UIResource with user-provided params
        const uiResource = await createWidgetUIResource(
          definition,
          params,
          serverConfig
        );

        // For Apps SDK, return _meta at top level with only text in content
        if (definition.type === "appsSdk") {
          // Generate a unique URI with random ID for each invocation
          const randomId = Math.random().toString(36).substring(2, 15);
          const uniqueUri = generateWidgetUri(
            definition.name,
            server.buildId,
            ".html",
            randomId
          );

          // Update toolMetadata with the unique URI and widget props
          const uniqueToolMetadata = {
            ...toolMetadata,
            "openai/outputTemplate": uniqueUri,
            "mcp-use/props": params, // Pass params as widget props
          };

          // Generate tool output (what the model sees)
          let toolOutputResult;
          if (definition.toolOutput) {
            // Use provided toolOutput (function or static)
            toolOutputResult =
              typeof definition.toolOutput === "function"
                ? definition.toolOutput(params)
                : definition.toolOutput;
          } else {
            // Default: text summary
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
          const content = toolOutputResult.content || [
            { type: "text" as const, text: `Displaying ${displayName}` },
          ];

          return {
            _meta: uniqueToolMetadata,
            content: content,
            structuredContent: toolOutputResult.structuredContent,
          };
        }

        // For other types, return standard response
        return {
          content: [
            {
              type: "text" as const,
              text: `Displaying ${displayName}`,
              description: `Show MCP-UI widget for ${displayName}`,
            },
            uiResource,
          ],
        };
      }
    );
  }

  return server;
}
