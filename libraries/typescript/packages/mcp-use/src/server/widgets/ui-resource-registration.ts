/**
 * UI Resource Registration
 *
 * This module handles the registration of UI widgets as both tools and resources
 * in the MCP server. It creates a unified interface for MCP-UI compatible widgets.
 */

import z from "zod";
import { getRequestContext } from "../context-storage.js";
import type {
  FlatResourceTemplateDefinition,
  FlatResourceTemplateDefinitionWithoutCallback,
  ResourceDefinition,
  ResourceDefinitionWithoutCallback,
  ResourceTemplateDefinition,
  ResourceTemplateDefinitionWithoutCallback,
  ToolDefinition,
  UIResourceDefinition,
} from "../types/index.js";
import { extractBaseUrl } from "../utils/server-helpers.js";
import { AppsSdkAdapter, McpAppsAdapter } from "./adapters/index.js";
import {
  buildDualProtocolMetadata,
  generateToolOutput,
  getBuildIdPart,
} from "./protocol-helpers.js";
import {
  applyDefaultProps,
  convertPropsToInputs,
  createWidgetUIResource,
  generateWidgetUri,
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
  /** Registrations storage for checking existing registrations (for HMR updates) */
  registrations?: {
    tools: Map<string, any>;
    resources: Map<string, any>;
    resourceTemplates: Map<string, any>;
  };
  /** Active sessions for sending notifications (for HMR updates) */
  sessions?: Map<string, { server?: { sendToolListChanged?: () => void } }>;
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
 * Enrich widget definition with server origin in CSP
 *
 * Auto-injects the server's origin into resourceDomains and baseUriDomains
 * to allow loading built assets (React widgets) from the server itself.
 */
function enrichDefinitionWithServerOrigin(
  definition: UIResourceDefinition,
  serverOrigin: string | null
): UIResourceDefinition {
  if (!serverOrigin || definition.type !== "mcpApps" || !definition.metadata) {
    return definition;
  }

  const enrichedMetadata = { ...definition.metadata };

  if (enrichedMetadata.csp) {
    enrichedMetadata.csp = { ...enrichedMetadata.csp };

    // Add server origin to resourceDomains (for loading scripts/styles)
    if (!enrichedMetadata.csp.resourceDomains) {
      enrichedMetadata.csp.resourceDomains = [serverOrigin];
    } else if (!enrichedMetadata.csp.resourceDomains.includes(serverOrigin)) {
      enrichedMetadata.csp.resourceDomains = [
        ...enrichedMetadata.csp.resourceDomains,
        serverOrigin,
      ];
    }

    // Add server origin to baseUriDomains (for <base> tag)
    if (!enrichedMetadata.csp.baseUriDomains) {
      enrichedMetadata.csp.baseUriDomains = [serverOrigin];
    } else if (!enrichedMetadata.csp.baseUriDomains.includes(serverOrigin)) {
      enrichedMetadata.csp.baseUriDomains = [
        ...enrichedMetadata.csp.baseUriDomains,
        serverOrigin,
      ];
    }
  }

  return {
    ...definition,
    metadata: enrichedMetadata,
  } as UIResourceDefinition;
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

  // Extract server origin for auto-injection into CSP
  const serverOrigin = server.serverBaseUrl
    ? new URL(server.serverBaseUrl).origin
    : null;

  // Enrich definition with server origin in CSP (for built React widgets)
  const enrichedDefinition = enrichDefinitionWithServerOrigin(
    definition,
    serverOrigin
  );

  // Check if this widget was already registered (for HMR updates)
  const isUpdate = server.widgetDefinitions.has(enrichedDefinition.name);

  // Store widget definition for use by tools with returnsWidget option
  // Store both appsSdk and mcpApps widgets with type information for dual-protocol support
  if (
    (enrichedDefinition.type === "appsSdk" ||
      enrichedDefinition.type === "mcpApps") &&
    enrichedDefinition._meta
  ) {
    server.widgetDefinitions.set(enrichedDefinition.name, {
      ...enrichedDefinition._meta,
      "mcp-use/widgetType": enrichedDefinition.type,
    } as Record<string, unknown>);

    // Update any existing tools that reference this widget
    // This fixes the timing issue where tools are registered before widgets are auto-discovered
    if (enrichedDefinition.type === "mcpApps" && server.registrations?.tools) {
      for (const [, toolReg] of server.registrations.tools) {
        // Check if this tool has a widget config referencing our widget
        const widgetConfig = (toolReg.config as any).widget;
        if (widgetConfig?.name === enrichedDefinition.name) {
          // Tool references this widget - update its metadata with dual-protocol support
          const buildIdPart = getBuildIdPart(server.buildId);
          const outputTemplate = `ui://widget/${enrichedDefinition.name}${buildIdPart}.html`;

          // Update tool metadata with dual-protocol support
          toolReg.config._meta = buildDualProtocolMetadata(
            enrichedDefinition,
            outputTemplate,
            toolReg.config._meta
          );
        }
      }
    }
  }

  // Determine resource URI and mimeType based on type
  let resourceUri: string;
  let mimeType: string;

  switch (enrichedDefinition.type) {
    case "externalUrl":
      resourceUri = generateWidgetUri(
        enrichedDefinition.widget,
        server.buildId
      );
      mimeType = "text/uri-list";
      break;
    case "rawHtml":
      resourceUri = generateWidgetUri(enrichedDefinition.name, server.buildId);
      mimeType = "text/html";
      break;
    case "remoteDom":
      resourceUri = generateWidgetUri(enrichedDefinition.name, server.buildId);
      mimeType = "application/vnd.mcp-ui.remote-dom+javascript";
      break;
    case "appsSdk":
      resourceUri = generateWidgetUri(
        enrichedDefinition.name,
        server.buildId,
        ".html"
      );
      mimeType = "text/html+skybridge";
      break;
    case "mcpApps":
      resourceUri = generateWidgetUri(
        enrichedDefinition.name,
        server.buildId,
        ".html"
      );
      // Default to MCP Apps MIME type, but we'll register with both protocols
      mimeType = "text/html;profile=mcp-app";
      break;
    default:
      throw new Error(
        `Unsupported UI resource type. Must be one of: externalUrl, rawHtml, remoteDom, appsSdk, mcpApps`
      );
  }

  // Create server config for widget UI resource creation
  const serverConfig: WidgetServerConfig = {
    serverHost: server.serverHost,
    serverPort: server.serverPort || 3000,
    serverBaseUrl: server.serverBaseUrl,
    buildId: server.buildId,
  };

  // Skip resource registration if this is an update (resources don't change, only metadata)
  if (!isUpdate) {
    // Register the resource
    server.resource({
      name: enrichedDefinition.name,
      uri: resourceUri,
      title: enrichedDefinition.title,
      description: enrichedDefinition.description,
      mimeType,
      _meta: enrichedDefinition._meta,
      annotations: enrichedDefinition.annotations,
      readCallback: async () => {
        // For externalUrl type, use default props. For others, use empty params
        const params =
          enrichedDefinition.type === "externalUrl"
            ? applyDefaultProps(enrichedDefinition.props)
            : {};

        // Get dynamic base URL from request context (respects gateway forwarding headers)
        const requestContext = getRequestContext();
        const dynamicBaseUrl = requestContext
          ? extractBaseUrl(requestContext.req)
          : null;

        // Use dynamic URL if available, otherwise fall back to static serverConfig
        const effectiveServerConfig: WidgetServerConfig = dynamicBaseUrl
          ? { ...serverConfig, serverBaseUrl: dynamicBaseUrl }
          : serverConfig;

        const uiResource = await createWidgetUIResource(
          enrichedDefinition,
          params,
          effectiveServerConfig
        );

        // Ensure the resource content URI matches the registered URI (with build ID)
        uiResource.resource.uri = resourceUri;

        return {
          contents: [uiResource.resource],
        };
      },
    });

    // For Apps SDK and MCP Apps, also register a resource template to handle dynamic URIs with random IDs
    if (
      enrichedDefinition.type === "appsSdk" ||
      enrichedDefinition.type === "mcpApps"
    ) {
      // Build URI template with build ID if available
      const buildIdPart = server.buildId ? `-${server.buildId}` : "";
      const uriTemplate = `ui://widget/${enrichedDefinition.name}${buildIdPart}-{id}.html`;

      server.resourceTemplate({
        name: `${enrichedDefinition.name}-dynamic`,
        resourceTemplate: {
          uriTemplate,
          name: enrichedDefinition.title || enrichedDefinition.name,
          description: enrichedDefinition.description,
          mimeType,
        },
        _meta: enrichedDefinition._meta,
        title: enrichedDefinition.title,
        description: enrichedDefinition.description,
        annotations: enrichedDefinition.annotations,
        readCallback: async (uri: URL, params: Record<string, string>) => {
          // Use empty params since structuredContent is passed separately

          // Get dynamic base URL from request context (respects gateway forwarding headers)
          const requestContext = getRequestContext();
          const dynamicBaseUrl = requestContext
            ? extractBaseUrl(requestContext.req)
            : null;

          // Use dynamic URL if available, otherwise fall back to static serverConfig
          const effectiveServerConfig: WidgetServerConfig = dynamicBaseUrl
            ? { ...serverConfig, serverBaseUrl: dynamicBaseUrl }
            : serverConfig;

          const uiResource = await createWidgetUIResource(
            enrichedDefinition,
            {},
            effectiveServerConfig
          );

          // Ensure the resource content URI matches the template URI (with build ID)
          uiResource.resource.uri = uri.toString();

          return {
            contents: [uiResource.resource],
          };
        },
      });
    }
  }

  // Check if tool should be registered (defaults to true for backward compatibility)
  // Check direct property first (from programmatic API), then fall back to _meta (from file-based widgets)
  const widgetMetadata = enrichedDefinition._meta?.["mcp-use/widget"] as
    | { exposeAsTool?: boolean }
    | undefined;
  const exposeAsTool =
    enrichedDefinition.exposeAsTool ?? widgetMetadata?.exposeAsTool ?? true;

  // Register the tool only if exposeAsTool is not false
  // Note: Resources and resource templates are always registered regardless of exposeAsTool
  // because custom tools may reference them via the widget() helper
  if (exposeAsTool) {
    // Build tool metadata using protocol adapters for dual-protocol support
    const toolMetadata: Record<string, unknown> =
      enrichedDefinition._meta || {};

    if (
      enrichedDefinition.type === "appsSdk" &&
      enrichedDefinition.appsSdkMetadata
    ) {
      // Apps SDK only: Add Apps SDK tool metadata
      toolMetadata["openai/outputTemplate"] = resourceUri;

      // Copy over tool-relevant metadata fields from appsSdkMetadata
      const toolMetadataFields = [
        "openai/toolInvocation/invoking",
        "openai/toolInvocation/invoked",
        "openai/widgetAccessible",
        "openai/resultCanProduceWidget",
      ] as const;

      for (const field of toolMetadataFields) {
        if (enrichedDefinition.appsSdkMetadata[field] !== undefined) {
          toolMetadata[field] = enrichedDefinition.appsSdkMetadata[field];
        }
      }
    } else if (enrichedDefinition.type === "mcpApps") {
      // MCP Apps: Generate metadata for BOTH protocols using adapters
      // Build dual-protocol metadata
      Object.assign(
        toolMetadata,
        buildDualProtocolMetadata(enrichedDefinition, resourceUri, toolMetadata)
      );
    }

    // Determine the input schema - check if props is a Zod schema
    // Also check for deprecated inputs/schema fields from widget metadata
    const widgetMetadataSchema = enrichedDefinition._meta?.[
      "mcp-use/widget"
    ] as { props?: unknown; inputs?: unknown; schema?: unknown } | undefined;

    // Check props, then fall back to deprecated inputs/schema fields
    const propsOrSchema =
      enrichedDefinition.props ||
      widgetMetadataSchema?.props ||
      widgetMetadataSchema?.inputs ||
      widgetMetadataSchema?.schema;

    // Check if it's a Zod schema
    const isZodSchema =
      propsOrSchema &&
      typeof propsOrSchema === "object" &&
      propsOrSchema instanceof z.ZodObject;

    // Check if it's a JSON Schema object (from production build)
    // A JSON Schema has either $schema or (type === "object" with properties)
    let isJsonSchema = false;
    if (propsOrSchema && typeof propsOrSchema === "object" && !isZodSchema) {
      const hasSchemaKey = Object.prototype.hasOwnProperty.call(
        propsOrSchema,
        "$schema"
      );
      const hasTypeObject =
        (propsOrSchema as any).type === "object" &&
        Object.prototype.hasOwnProperty.call(propsOrSchema, "properties");
      isJsonSchema = hasSchemaKey || hasTypeObject;
    }

    // Build tool definition with appropriate schema format
    const toolDefinition: ToolDefinition = {
      name: enrichedDefinition.name,
      title: enrichedDefinition.title,
      description: enrichedDefinition.description,
      annotations: enrichedDefinition.toolAnnotations,
      _meta: Object.keys(toolMetadata).length > 0 ? toolMetadata : undefined,
    };

    if (isZodSchema) {
      // Pass Zod schema directly - the tool registration will convert it to JSON schema
      toolDefinition.schema = propsOrSchema as z.ZodObject<any>;
    } else if (isJsonSchema) {
      // JSON Schema from production build - convert properties to InputDefinition array
      const jsonSchema = propsOrSchema as {
        properties?: Record<
          string,
          { type?: string; description?: string; default?: unknown }
        >;
        required?: string[];
      };
      if (jsonSchema.properties) {
        const requiredFields = new Set(jsonSchema.required || []);
        toolDefinition.inputs = Object.entries(jsonSchema.properties).map(
          ([name, prop]) => ({
            name,
            type: (prop.type || "string") as
              | "string"
              | "number"
              | "boolean"
              | "object"
              | "array",
            description: prop.description,
            required: requiredFields.has(name),
            default: prop.default,
          })
        );
      }
    } else if (propsOrSchema) {
      // Legacy WidgetProps format - convert to InputDefinition array
      toolDefinition.inputs = convertPropsToInputs(
        propsOrSchema as import("../types/resource.js").WidgetProps
      );
    }

    // Tool callback function (used for both new registration and updates)
    const toolCallback = async (params: Record<string, unknown>) => {
      // For HMR updates, read metadata from the tool registration config to get latest values
      // This ensures we use updated metadata after HMR instead of the closed-over initial value
      const currentToolMeta =
        server.registrations?.tools?.get(enrichedDefinition.name)?.config
          ?._meta || toolMetadata;

      // Debug logging
      console.log(
        `[TOOL CALLBACK] ${enrichedDefinition.name} - currentToolMeta.ui:`,
        currentToolMeta.ui ? "present" : "missing"
      );

      // Get dynamic base URL from request context (respects gateway forwarding headers)
      const requestContext = getRequestContext();
      const dynamicBaseUrl = requestContext
        ? extractBaseUrl(requestContext.req)
        : null;

      // Use dynamic URL if available, otherwise fall back to static serverConfig
      const effectiveServerConfig: WidgetServerConfig = dynamicBaseUrl
        ? { ...serverConfig, serverBaseUrl: dynamicBaseUrl }
        : serverConfig;

      // Create the UIResource with user-provided params
      const uiResource = await createWidgetUIResource(
        enrichedDefinition,
        params,
        effectiveServerConfig
      );

      // For Apps SDK, return _meta at top level with only text in content
      if (enrichedDefinition.type === "appsSdk") {
        // Generate a unique URI with random ID for each invocation
        const randomId = Math.random().toString(36).substring(2, 15);
        const uniqueUri = generateWidgetUri(
          enrichedDefinition.name,
          server.buildId,
          ".html",
          randomId
        );

        // Update toolMetadata with the unique URI and widget props
        const uniqueToolMetadata = {
          ...currentToolMeta,
          "openai/outputTemplate": uniqueUri,
          "mcp-use/props": params, // Pass params as widget props
        };

        // Dynamically update CSP domains to include the gateway URL
        if (dynamicBaseUrl && uniqueToolMetadata["openai/widgetCSP"]) {
          try {
            const serverOrigin = new URL(dynamicBaseUrl).origin;
            const widgetCSP = uniqueToolMetadata["openai/widgetCSP"] as {
              connect_domains?: string[];
              resource_domains?: string[];
            };

            // Add server origin to connect_domains
            if (widgetCSP.connect_domains) {
              widgetCSP.connect_domains = Array.from(
                new Set([...widgetCSP.connect_domains, serverOrigin])
              );
            }

            // Add server origin to resource_domains
            if (widgetCSP.resource_domains) {
              widgetCSP.resource_domains = Array.from(
                new Set([...widgetCSP.resource_domains, serverOrigin])
              );
            }
          } catch (e) {
            // Ignore URL parsing errors
          }
        }

        // Generate tool output (what the model sees)
        const toolOutputResult = enrichedDefinition.toolOutput
          ? typeof enrichedDefinition.toolOutput === "function"
            ? enrichedDefinition.toolOutput(params)
            : enrichedDefinition.toolOutput
          : generateToolOutput(enrichedDefinition, params, displayName);

        // Ensure content exists (required by CallToolResult)
        const content = toolOutputResult.content || [
          { type: "text" as const, text: displayName },
        ];

        return {
          _meta: uniqueToolMetadata,
          content: content,
          structuredContent: toolOutputResult.structuredContent,
        };
      }

      // For MCP Apps, return dual-protocol response with _meta and resource
      if (enrichedDefinition.type === "mcpApps") {
        // Generate a unique URI with random ID for each invocation
        const randomId = Math.random().toString(36).substring(2, 15);
        const uniqueUri = generateWidgetUri(
          enrichedDefinition.name,
          server.buildId,
          ".html",
          randomId
        );

        // Build dual-protocol metadata using both adapters
        const mcpAppsAdapter = new McpAppsAdapter();
        const appsSdkAdapter = new AppsSdkAdapter();

        const mcpAppsUniqueMeta = mcpAppsAdapter.buildToolMetadata(
          enrichedDefinition,
          uniqueUri
        );
        const appsSdkUniqueMeta = appsSdkAdapter.buildToolMetadata(
          enrichedDefinition,
          uniqueUri
        );

        // Deep merge to preserve ui.csp and other nested fields from current tool metadata
        const existingUi = currentToolMeta.ui as
          | Record<string, unknown>
          | undefined;
        const mcpAppsUi = mcpAppsUniqueMeta.ui as
          | Record<string, unknown>
          | undefined;

        const uniqueToolMetadata: Record<string, unknown> = {
          ...currentToolMeta,
          ...mcpAppsUniqueMeta,
          ...appsSdkUniqueMeta,
          "mcp-use/props": params, // Pass params as widget props
        };

        // Deep merge ui field to preserve CSP, prefersBorder, autoResize
        if (existingUi && mcpAppsUi) {
          uniqueToolMetadata.ui = { ...existingUi, ...mcpAppsUi };
        }

        // Dynamically update CSP domains to include the gateway URL (both protocols)
        if (dynamicBaseUrl) {
          try {
            const serverOrigin = new URL(dynamicBaseUrl).origin;

            // Update MCP Apps CSP (ui.csp.connectDomains, resourceDomains, baseUriDomains)
            if (
              uniqueToolMetadata.ui &&
              typeof uniqueToolMetadata.ui === "object"
            ) {
              const ui = uniqueToolMetadata.ui as Record<string, unknown>;
              if (ui.csp && typeof ui.csp === "object") {
                const csp = ui.csp as Record<string, unknown>;

                // Add to connectDomains
                if (Array.isArray(csp.connectDomains)) {
                  csp.connectDomains = Array.from(
                    new Set([...csp.connectDomains, serverOrigin])
                  );
                }

                // Add to resourceDomains
                if (Array.isArray(csp.resourceDomains)) {
                  csp.resourceDomains = Array.from(
                    new Set([...csp.resourceDomains, serverOrigin])
                  );
                }

                // Add to baseUriDomains
                if (Array.isArray(csp.baseUriDomains)) {
                  csp.baseUriDomains = Array.from(
                    new Set([...csp.baseUriDomains, serverOrigin])
                  );
                }
              }
            }

            // Update Apps SDK CSP (openai/widgetCSP)
            if (
              uniqueToolMetadata["openai/widgetCSP"] &&
              typeof uniqueToolMetadata["openai/widgetCSP"] === "object"
            ) {
              const widgetCSP = uniqueToolMetadata["openai/widgetCSP"] as {
                connect_domains?: string[];
                resource_domains?: string[];
              };

              // Add to connect_domains
              if (Array.isArray(widgetCSP.connect_domains)) {
                widgetCSP.connect_domains = Array.from(
                  new Set([...widgetCSP.connect_domains, serverOrigin])
                );
              }

              // Add to resource_domains
              if (Array.isArray(widgetCSP.resource_domains)) {
                widgetCSP.resource_domains = Array.from(
                  new Set([...widgetCSP.resource_domains, serverOrigin])
                );
              }
            }
          } catch (e) {
            // Ignore URL parsing errors
          }
        }

        // Generate tool output (what the model sees)
        const toolOutputResult = enrichedDefinition.toolOutput
          ? typeof enrichedDefinition.toolOutput === "function"
            ? enrichedDefinition.toolOutput(params)
            : enrichedDefinition.toolOutput
          : generateToolOutput(enrichedDefinition, params, displayName);

        // Ensure content exists (required by CallToolResult)
        const content = toolOutputResult?.content || [
          { type: "text" as const, text: displayName },
        ];

        return {
          _meta: uniqueToolMetadata, // For ChatGPT compatibility
          content: [
            ...(Array.isArray(content) ? content : [content]),
            uiResource, // For MCP Apps clients
          ],
          structuredContent: toolOutputResult?.structuredContent,
        };
      }

      // For other types (legacy MCP-UI), return standard response
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
    };

    if (isUpdate && server.registrations?.tools) {
      // HMR update: update existing tool registration directly
      const existingTool = server.registrations.tools.get(
        enrichedDefinition.name
      );
      if (existingTool) {
        // Update the tool config with new metadata
        existingTool.config = {
          ...existingTool.config,
          title: toolDefinition.title,
          description: toolDefinition.description,
          annotations: toolDefinition.annotations,
          _meta: toolDefinition._meta,
          inputs: toolDefinition.inputs,
          schema: toolDefinition.schema,
        };
        existingTool.handler = toolCallback as any;

        // Notify active sessions about the tool list change
        if (server.sessions) {
          for (const [, session] of server.sessions) {
            if (session.server?.sendToolListChanged) {
              try {
                session.server.sendToolListChanged();
              } catch {
                // Session may be disconnected, ignore errors
              }
            }
          }
        }
      }
    } else {
      // Initial registration - use addWidgetTool to ensure immediate visibility
      console.log(
        `[UI Registration] Registering new tool: ${enrichedDefinition.name}`
      );

      // Check if server has addWidgetTool method (for direct session state updates)
      if (typeof (server as any).addWidgetTool === "function") {
        (server as any).addWidgetTool(toolDefinition, toolCallback);
      } else {
        // Fallback to regular tool registration
        server.tool(toolDefinition, toolCallback);

        // Send notifications after a delay
        setTimeout(() => {
          if (server.sessions) {
            for (const [sessionId, session] of server.sessions) {
              if (session.server?.sendToolListChanged) {
                try {
                  session.server.sendToolListChanged();
                } catch (error) {
                  console.debug(
                    `Failed to send notification to session ${sessionId}`
                  );
                }
              }
            }
          }
        }, 50);
      }
    }
  }

  return server;
}
