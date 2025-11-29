import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Typed CallToolResult that constrains the structuredContent property
 * to match a specific type T. Used for output schema validation.
 * T must be a record type (object) to match the SDK's CallToolResult interface.
 */
export interface TypedCallToolResult<T extends Record<string, unknown> = Record<string, unknown>> extends Omit<CallToolResult, 'structuredContent'> {
  structuredContent?: T;
}

/**
 * Create a text content response for MCP tools
 * 
 * @param content - The text content to return
 * @returns CallToolResult with text content
 * 
 * @example
 * ```typescript
 * server.tool({
 *   name: 'greet',
 *   schema: z.object({ name: z.string() }),
 *   cb: async ({ name }) => text(`Hello, ${name}!`)
 * })
 * ```
 */
export function text(content: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: content,
      },
    ],
  };
}

/**
 * Create an image content response for MCP tools
 * 
 * @param data - The image data (data URL or base64)
 * @param mimeType - MIME type (e.g., 'image/png', defaults to 'image/png')
 * @returns CallToolResult with image content
 * 
 * @example
 * ```typescript
 * server.tool({
 *   name: 'generate-image',
 *   cb: async () => image('data:image/png;base64,...', 'image/png')
 * })
 * ```
 */
export function image(data: string, mimeType: string = "image/png"): CallToolResult {
  return {
    content: [
      {
        type: "image",
        data,
        mimeType,
      },
    ],
  };
}

/**
 * Create a resource content response for MCP tools
 * 
 * @param uri - The resource URI
 * @param mimeType - Optional MIME type
 * @param text - Optional text content for the resource
 * @returns CallToolResult with resource content
 * 
 * @example
 * ```typescript
 * server.tool({
 *   name: 'get-config',
 *   cb: async () => resource('file:///config.json', 'application/json')
 * })
 * ```
 */
export function resource(uri: string, mimeType?: string, text?: string): CallToolResult {
  const resourceContent: any = {
    type: "resource",
    resource: {
      uri,
      ...(mimeType && { mimeType }),
      ...(text && { text }),
    },
  };

  return {
    content: [resourceContent],
  };
}

/**
 * Create an error response for MCP tools
 * 
 * @param message - The error message
 * @returns CallToolResult marked as error
 * 
 * @example
 * ```typescript
 * server.tool({
 *   name: 'risky-operation',
 *   cb: async () => {
 *     if (somethingWrong) {
 *       return error('Operation failed: invalid input')
 *     }
 *     return text('Success!')
 *   }
 * })
 * ```
 */
export function error(message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}

/**
 * Create a JSON object response for MCP tools
 * 
 * @param data - The object to return as JSON
 * @returns TypedCallToolResult with JSON text content and typed structuredContent
 * 
 * @example
 * ```typescript
 * server.tool({
 *   name: 'get-user-info',
 *   cb: async (_args, _ctx, { auth }) => object({
 *     userId: auth.user.userId,
 *     email: auth.user.email
 *   })
 * })
 * ```
 */
export function object<T extends Record<string, any>>(data: T): TypedCallToolResult<T> {
  return Array.isArray(data) ? array(data) as any : {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}


export function array<T extends any[]>(data: T): TypedCallToolResult<{data: T}> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: {data: data},
  };
}



/**
 * Configuration for widget response utility
 */
export interface WidgetResponseConfig {
  /** Widget name from resources folder */
  name: string;
  /** Structured data to pass to the widget */
  data: Record<string, any>;
  /** Optional text message (defaults to "Displaying {name}") */
  message?: string;
  /** Status text while tool is invoking */
  invoking?: string;
  /** Status text after tool has invoked */
  invoked?: string;
  /** Whether the widget can initiate tool calls (defaults to true) */
  widgetAccessible?: boolean;
  /** Whether this tool result can produce a widget (defaults to true) */
  resultCanProduceWidget?: boolean;
  /** Optional build ID for cache busting (usually auto-set by server) */
  buildId?: string;
}

/**
 * Create a widget response for MCP tools
 * 
 * Returns a complete tool result configured to display an OpenAI Apps SDK widget.
 * This allows any tool to return a widget, not just auto-registered widget tools.
 * 
 * The widget must exist in your resources folder and be registered with the server
 * using `server.uiResource()`.
 * 
 * @param config - Widget response configuration
 * @returns CallToolResult with widget metadata and structured content
 * 
 * @example
 * ```typescript
 * server.tool({
 *   name: 'get-weather',
 *   schema: z.object({ city: z.string() }),
 *   cb: async ({ city }) => {
 *     const weatherData = await fetchWeather(city);
 *     return widget({
 *       name: 'weather-display',
 *       data: weatherData,
 *       message: `Showing weather for ${city}`
 *     });
 *   }
 * })
 * ```
 */
export function widget(config: WidgetResponseConfig): CallToolResult {
  const {
    name,
    data,
    message,
    invoking,
    invoked,
    widgetAccessible = true,
    resultCanProduceWidget = true,
    buildId,
  } = config;

  // Generate a unique URI with random ID for each invocation
  // This matches the pattern in mcp-server.ts lines 1094-1099
  const randomId = Math.random().toString(36).substring(2, 15);
  const buildIdPart = buildId ? `-${buildId}` : "";
  const uniqueUri = `ui://widget/${name}${buildIdPart}-${randomId}.html`;

  // Build the metadata object
  const metadata: Record<string, unknown> = {
    "openai/outputTemplate": uniqueUri,
    "openai/widgetAccessible": widgetAccessible,
    "openai/resultCanProduceWidget": resultCanProduceWidget,
  };

  // Add optional invocation status messages
  if (invoking) {
    metadata["openai/toolInvocation/invoking"] = invoking;
  }
  if (invoked) {
    metadata["openai/toolInvocation/invoked"] = invoked;
  }

  // Default message
  const displayMessage = message || `Displaying ${name}`;

  return {
    _meta: metadata,
    content: [
      {
        type: "text",
        text: displayMessage,
      },
    ],
    // structuredContent will be injected as window.openai.toolOutput by Apps SDK
    structuredContent: data,
  };
}


export function mix(...results: CallToolResult[]): CallToolResult {
  const structuredContent = results.find(result => result.structuredContent) && results.filter(result => result.structuredContent).map(result => result.structuredContent).reduce((acc, result) => {
    return { ...acc, ...result };
  }, {} as Record<string, unknown>);
  const _meta = results.find(result => result._meta) && results.filter(result => result._meta).map(result => result._meta).reduce((acc, result) => {
    return { ...acc, ...result };
  }, {} as Record<string, unknown>);    
  return {
    content: results.flatMap(result => result.content),
    ...(structuredContent && { structuredContent }),
    ...(_meta && { _meta }),
  };
}
