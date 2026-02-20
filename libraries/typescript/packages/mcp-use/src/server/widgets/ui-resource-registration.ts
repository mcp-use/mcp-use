/**
 * UI Resource Registration
 *
 * This module handles the registration of UI widgets as both tools and resources
 * in the MCP server. It creates a unified interface for MCP-UI compatible widgets.
 */

import z from "zod";
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
import {
  applyDefaultProps,
  convertPropsToInputs,
  createWidgetUIResource,
  generateWidgetUri,
  type WidgetServerConfig,
} from "./widget-helpers.js";
import {
  buildDualProtocolMetadata,
  buildResourceUiMeta,
  generateToolOutput,
  getBuildIdPart,
} from "./protocol-helpers.js";

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
 * Auto-injects the server's origin into connectDomains, resourceDomains, and baseUriDomains
 * to allow loading built assets (React widgets) from the server itself.
 */
function enrichDefinitionWithServerOrigin(
  definition: UIResourceDefinition,
  serverOrigin: string | null
): UIResourceDefinition {
  if (!serverOrigin || definition.type !== "mcpApps") {
    return definition;
  }

  // Create metadata if it doesn't exist
  const enrichedMetadata = definition.metadata
    ? { ...definition.metadata }
    : ({} as NonNullable<typeof definition.metadata>);

  // Always ensure CSP exists so the server origin is injected even when
  // the widget author didn't explicitly declare a csp config
  if (!enrichedMetadata.csp) {
    enrichedMetadata.csp = {};
  } else {
    enrichedMetadata.csp = { ...enrichedMetadata.csp };
  }

  // Add server origin to resourceDomains (for loading scripts/styles)
  if (!enrichedMetadata.csp.resourceDomains) {
    enrichedMetadata.csp.resourceDomains = [serverOrigin];
  } else if (!enrichedMetadata.csp.resourceDomains.includes(serverOrigin)) {
    enrichedMetadata.csp.resourceDomains = [
      ...enrichedMetadata.csp.resourceDomains,
      serverOrigin,
    ];
  }

  // Add server origin to connectDomains (for fetch/XHR/WebSocket)
  if (!enrichedMetadata.csp.connectDomains) {
    enrichedMetadata.csp.connectDomains = [serverOrigin];
  } else if (!enrichedMetadata.csp.connectDomains.includes(serverOrigin)) {
    enrichedMetadata.csp.connectDomains = [
      ...enrichedMetadata.csp.connectDomains,
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

  // Store minimal widget definition for use by tools with widget config.
  // Only store what's needed to build protocol metadata at tool-call time:
  // - widgetType: to decide mcpApps vs appsSdk code path
  // - metadata: CSP/domain config needed by protocol adapters
  // No mcp-use/* keys are stored — they don't belong on the wire.
  if (
    enrichedDefinition.type === "appsSdk" ||
    enrichedDefinition.type === "mcpApps"
  ) {
    server.widgetDefinitions.set(enrichedDefinition.name, {
      widgetType: enrichedDefinition.type,
      metadata:
        enrichedDefinition.type === "mcpApps"
          ? enrichedDefinition.metadata
          : undefined,
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

  // Per MCP Apps spec (SEP-1865): resource _meta.ui should contain CSP,
  // prefersBorder, domain, permissions. Build it from the enriched definition.
  const resourceUiMeta =
    enrichedDefinition.type === "mcpApps"
      ? buildResourceUiMeta(enrichedDefinition)
      : undefined;

  // The listing-level _meta is separate from the content _meta returned by resources/read.
  // Internal "mcp-use/widget" bookkeeping is excluded entirely.
  // "mcp-use/propsSchema" is a mcp-use private extension forwarded as-is: the inspector
  // reads it from resource._meta to power PropsConfigDialog. Other hosts ignore unknown
  // _meta keys, so this stays out of the spec's _meta.ui namespace.
  const defMeta = enrichedDefinition._meta as
    | Record<string, unknown>
    | undefined;
  const defMetaPublic = defMeta
    ? Object.fromEntries(
        Object.entries(defMeta).filter(
          ([k]) => k !== "mcp-use/widget" && k !== "ui"
        )
      )
    : {};
  const listingUi = resourceUiMeta || {};
  const resourceMeta = {
    ...defMetaPublic,
    ...(Object.keys(listingUi).length > 0 ? { ui: listingUi } : {}),
  };

  // Resolve the latest enriched definition dynamically.
  // During HMR, widgetDefinitions is updated with the new definition but
  // the original readCallback closure can't be replaced in the MCP SDK.
  // By reading from widgetDefinitions at call time, the callback always
  // uses the latest metadata (e.g. prefersBorder, CSP).
  const getLatestDefinition = (): UIResourceDefinition => {
    const stored = server.widgetDefinitions.get(enrichedDefinition.name);
    const full = (stored as any)?.["mcp-use/fullDefinition"];
    return (full as UIResourceDefinition) ?? enrichedDefinition;
  };

  const resourceReadCallback = async () => {
    const latestDef = getLatestDefinition();
    const params =
      latestDef.type === "externalUrl"
        ? applyDefaultProps(latestDef.props)
        : {};

    const uiResource = await createWidgetUIResource(
      latestDef,
      params,
      serverConfig
    );

    uiResource.resource.uri = resourceUri;

    return {
      contents: [uiResource.resource],
    };
  };

  const templateReadCallback = async (
    uri: URL,
    _params: Record<string, string>
  ) => {
    const latestDef = getLatestDefinition();
    const uiResource = await createWidgetUIResource(
      latestDef,
      {},
      serverConfig
    );

    uiResource.resource.uri = uri.toString();

    return {
      contents: [uiResource.resource],
    };
  };

  if (!isUpdate) {
    // Initial registration
    server.resource({
      name: enrichedDefinition.name,
      uri: resourceUri,
      title: enrichedDefinition.title,
      description: enrichedDefinition.description,
      mimeType,
      _meta: resourceMeta,
      annotations: enrichedDefinition.annotations,
      readCallback: resourceReadCallback,
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
        _meta: resourceMeta,
        title: enrichedDefinition.title,
        description: enrichedDefinition.description,
        annotations: enrichedDefinition.annotations,
        readCallback: templateReadCallback,
      });
    }
  } else if (server.registrations) {
    // HMR update: update existing resource handler and metadata so that
    // resources/read returns fresh content (e.g. updated prefersBorder, CSP).
    const resourceKey = `${enrichedDefinition.name}:${resourceUri}`;
    const existingResource = server.registrations.resources?.get(resourceKey);
    if (existingResource) {
      existingResource.config = {
        ...existingResource.config,
        _meta: resourceMeta,
      };
      existingResource.handler = resourceReadCallback as any;
    }

    const resourceTemplateKey = `${enrichedDefinition.name}-dynamic`;
    const existingTemplate =
      server.registrations.resourceTemplates?.get(resourceTemplateKey);
    if (existingTemplate) {
      existingTemplate.config = {
        ...existingTemplate.config,
        _meta: resourceMeta,
      };
      existingTemplate.handler = templateReadCallback as any;
    }
  }

  // Check if tool should be registered (defaults to true for backward compatibility)
  // Check direct property first (from programmatic API), then fall back to _meta (from file-based widgets)
  const widgetMetadata = enrichedDefinition._meta?.["mcp-use/widget"] as
    | { exposeAsTool?: boolean }
    | undefined;
  const exposeAsTool =
    enrichedDefinition.exposeAsTool ?? widgetMetadata?.exposeAsTool ?? true;

  // FIX: Propagate newly registered resources to existing sessions independently of tool registration
  // Previously, resource propagation was only done inside addWidgetTool (which requires exposeAsTool=true).
  // Resources must be pushed to existing sessions regardless of whether the widget exposes a tool.
  if (
    !isUpdate &&
    (server as any).sessions &&
    typeof (server as any).propagateWidgetResourcesToSessions === "function"
  ) {
    (server as any).propagateWidgetResourcesToSessions(enrichedDefinition.name);
  }

  // Register the tool only if exposeAsTool is not false
  // Note: Resources and resource templates are always registered regardless of exposeAsTool
  // because custom tools may reference them via the widget() helper
  if (exposeAsTool) {
    // Build tool metadata using protocol adapters for dual-protocol support.
    // Only include protocol-standard fields (ui.resourceUri, openai/*) — no mcp-use/* keys.
    const toolMetadata: Record<string, unknown> = {};

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
      // For Apps SDK or MCP Apps, return clean tool result per Apps SDK spec.
      // Per OpenAI Apps SDK: tool results contain structuredContent, content
      // (text items), and optional _meta. The widget HTML is NOT in the result;
      // the host fetches it via resources/read using openai/outputTemplate from
      // the tool definition.
      // See: https://developers.openai.com/apps-sdk/build/mcp-server
      if (
        enrichedDefinition.type === "appsSdk" ||
        enrichedDefinition.type === "mcpApps"
      ) {
        // Generate tool output (what the model sees)
        const toolOutputResult = enrichedDefinition.toolOutput
          ? typeof enrichedDefinition.toolOutput === "function"
            ? enrichedDefinition.toolOutput(params)
            : enrichedDefinition.toolOutput
          : generateToolOutput(enrichedDefinition, params, displayName);

        // Ensure content exists (required by CallToolResult) - text items only
        const content = toolOutputResult?.content || [
          { type: "text" as const, text: displayName },
        ];
        const contentArray = Array.isArray(content) ? content : [content];

        return {
          content: contentArray,
          structuredContent: toolOutputResult?.structuredContent ?? params,
        };
      }

      // For other types (legacy MCP-UI), return standard response with embedded resource
      const uiResource = await createWidgetUIResource(
        enrichedDefinition,
        params,
        serverConfig
      );
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
