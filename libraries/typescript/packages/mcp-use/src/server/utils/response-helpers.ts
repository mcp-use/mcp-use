import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fsHelpers, isDeno } from "./runtime.js";

/**
 * Typed CallToolResult that constrains the structuredContent property
 * to match a specific type T. Used for output schema validation.
 * T must be a record type (object) to match the SDK's CallToolResult interface.
 */
export interface TypedCallToolResult<
  T extends Record<string, unknown> = Record<string, unknown>,
> extends Omit<CallToolResult, "structuredContent"> {
  structuredContent?: T;
}

/**
 * Create a text content response for MCP tools and resources
 *
 * @param content - The text content to return
 * @returns CallToolResult with text content
 *
 * @example
 * ```typescript
 * // For tools
 * server.tool({
 *   name: 'greet',
 *   schema: z.object({ name: z.string() }),
 *   cb: async ({ name }) => text(`Hello, ${name}!`)
 * })
 *
 * // For resources
 * server.resource(
 *   { name: 'greeting', uri: 'app://greeting' },
 *   async () => text('Hello World!')
 * )
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
    _meta: {
      mimeType: "text/plain",
    },
  };
}

/**
 * Create an image content response for MCP tools and resources
 *
 * @param data - The image data (data URL or base64)
 * @param mimeType - MIME type (e.g., 'image/png', defaults to 'image/png')
 * @returns CallToolResult with image content
 *
 * @example
 * ```typescript
 * // For tools
 * server.tool({
 *   name: 'generate-image',
 *   cb: async () => image('data:image/png;base64,...', 'image/png')
 * })
 *
 * // For resources
 * server.resource(
 *   { name: 'logo', uri: 'asset://logo' },
 *   async () => image(base64Data, 'image/png')
 * )
 * ```
 */
export function image(
  data: string,
  mimeType: string = "image/png"
): CallToolResult {
  return {
    content: [
      {
        type: "image",
        data,
        mimeType,
      },
    ],
    _meta: {
      mimeType,
      isImage: true,
    },
  };
}

/**
 * Helper function to infer audio MIME type from file extension
 *
 * @param filename - The filename or path
 * @returns Audio MIME type string
 */
function getAudioMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "wav":
      return "audio/wav";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "webm":
      return "audio/webm";
    case "flac":
      return "audio/flac";
    case "aac":
      return "audio/aac";
    default:
      return "audio/wav";
  }
}

/**
 * Convert ArrayBuffer to base64 string in a cross-runtime compatible way
 *
 * @param buffer - The ArrayBuffer to convert
 * @returns Base64 encoded string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (isDeno) {
    // Deno: use btoa with Uint8Array
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } else {
    // Node.js: use Buffer
    return Buffer.from(buffer).toString("base64");
  }
}

/**
 * Create an audio content response for MCP tools and resources
 *
 * Accepts either base64 data or a file path. File paths will be automatically
 * detected and read asynchronously, returning a Promise<CallToolResult>.
 *
 * @param dataOrPath - Audio data as base64 string, or path to audio file
 * @param mimeType - MIME type (e.g., 'audio/wav'). If not provided, defaults to 'audio/wav'
 *                   for base64 data, or inferred from file extension for file paths
 * @returns CallToolResult for base64 data, or Promise<CallToolResult> for file paths
 *
 * @example
 * ```typescript
 * // With base64 data (synchronous)
 * server.tool({
 *   name: 'generate-audio',
 *   cb: async () => audio(base64AudioData, 'audio/wav')
 * })
 *
 * // With file path (asynchronous)
 * server.resource(
 *   { name: 'notification', uri: 'audio://notification' },
 *   async () => await audio('./sounds/notification.wav')
 * )
 * ```
 */
export function audio(
  dataOrPath: string,
  mimeType?: string
): CallToolResult | Promise<CallToolResult> {
  // Check if it's a file path (contains path separators or file extension)
  const isFilePath =
    dataOrPath.includes("/") ||
    dataOrPath.includes("\\") ||
    dataOrPath.includes(".");

  // If it looks like a file path and doesn't look like pure base64, treat it as a path
  if (isFilePath && dataOrPath.length < 1000) {
    // Async file reading path
    return (async () => {
      const buffer = await fsHelpers.readFile(dataOrPath);
      const base64Data = arrayBufferToBase64(buffer);
      const inferredMimeType = mimeType || getAudioMimeType(dataOrPath);

      return {
        content: [
          {
            type: "audio",
            data: base64Data,
            mimeType: inferredMimeType,
          },
        ],
        _meta: {
          mimeType: inferredMimeType,
          isAudio: true,
        },
      };
    })();
  }

  // Sync base64 data path
  const finalMimeType = mimeType || "audio/wav";
  return {
    content: [
      {
        type: "audio",
        data: dataOrPath,
        mimeType: finalMimeType,
      },
    ],
    _meta: {
      mimeType: finalMimeType,
      isAudio: true,
    },
  };
}

/**
 * Create a resource content response for MCP tools
 *
 * Supports two usage patterns:
 * 1. Three arguments: resource(uri, mimeType, text)
 * 2. Two arguments: resource(uri, content) where content is a CallToolResult from helpers
 *
 * @param uri - The resource URI
 * @param mimeTypeOrContent - MIME type (3-arg pattern) or CallToolResult (2-arg pattern)
 * @param text - Optional text content (only for 3-arg pattern)
 * @returns CallToolResult with resource content
 *
 * @example
 * ```typescript
 * // 3-arg pattern: Explicit mimeType and text
 * server.tool({
 *   name: 'get-config',
 *   cb: async () => resource('test://embedded', 'text/plain', 'This is text content')
 * })
 *
 * // 2-arg pattern: Using text helper
 * server.tool({
 *   name: 'get-greeting',
 *   cb: async () => resource('test://embedded', text('Hello'))
 * })
 *
 * // 2-arg pattern: Using object helper
 * server.tool({
 *   name: 'get-data',
 *   cb: async () => resource('test://data', object({ test: 'data', value: 123 }))
 * })
 * ```
 */
export function resource(
  uri: string,
  mimeTypeOrContent: string | CallToolResult | TypedCallToolResult<any>,
  text?: string
): CallToolResult {
  // Handle 2-arg pattern: resource(uri, CallToolResult)
  if (
    typeof mimeTypeOrContent === "object" &&
    mimeTypeOrContent !== null &&
    "content" in mimeTypeOrContent
  ) {
    const contentResult = mimeTypeOrContent as CallToolResult;

    // Extract text and mimeType from the CallToolResult
    let extractedText: string | undefined;
    let extractedMimeType: string | undefined;

    // Get mimeType from _meta if available
    if (contentResult._meta && typeof contentResult._meta === "object") {
      const meta = contentResult._meta as Record<string, any>;
      if (meta.mimeType && typeof meta.mimeType === "string") {
        extractedMimeType = meta.mimeType;
      }
    }

    // Get text from first content item
    if (contentResult.content && contentResult.content.length > 0) {
      const firstContent = contentResult.content[0];
      if (firstContent.type === "text" && "text" in firstContent) {
        extractedText = (firstContent as any).text;
      }
    }

    const resourceContent: any = {
      type: "resource",
      resource: {
        uri,
        ...(extractedMimeType && { mimeType: extractedMimeType }),
        ...(extractedText && { text: extractedText }),
      },
    };

    return {
      content: [resourceContent],
    };
  }

  // Handle 3-arg pattern: resource(uri, mimeType, text)
  const mimeType = mimeTypeOrContent as string | undefined;
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
 * Create a JSON object response for MCP tools and resources
 *
 * @param data - The object to return as JSON
 * @returns TypedCallToolResult with JSON text content and typed structuredContent
 *
 * @example
 * ```typescript
 * // For tools
 * server.tool({
 *   name: 'get-user-info',
 *   cb: async (_args, _ctx, { auth }) => object({
 *     userId: auth.user.userId,
 *     email: auth.user.email
 *   })
 * })
 *
 * // For resources
 * server.resource(
 *   { name: 'config', uri: 'config://settings' },
 *   async () => object({ theme: 'dark', version: '1.0' })
 * )
 * ```
 */
export function object<T extends Record<string, any>>(
  data: T
): TypedCallToolResult<T> {
  return Array.isArray(data)
    ? (array(data) as any)
    : {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
        structuredContent: data,
        _meta: {
          mimeType: "application/json",
        },
      };
}

export function array<T extends any[]>(
  data: T
): TypedCallToolResult<{ data: T }> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: { data: data },
  };
}

/**
 * Create an HTML content response for MCP tools and resources
 *
 * @param content - The HTML content to return
 * @returns CallToolResult with HTML text content and MIME type metadata
 *
 * @example
 * ```typescript
 * server.resource(
 *   { name: 'page', uri: 'ui://dashboard' },
 *   async () => html('<h1>Dashboard</h1><p>Welcome</p>')
 * )
 * ```
 */
export function html(content: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: content,
      },
    ],
    _meta: {
      mimeType: "text/html",
    },
  };
}

/**
 * Create a Markdown content response for MCP tools and resources
 *
 * @param content - The Markdown content to return
 * @returns CallToolResult with Markdown text content and MIME type metadata
 *
 * @example
 * ```typescript
 * server.resource(
 *   { name: 'readme', uri: 'doc://readme' },
 *   async () => markdown('# Welcome\n\nGetting started...')
 * )
 * ```
 */
export function markdown(content: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: content,
      },
    ],
    _meta: {
      mimeType: "text/markdown",
    },
  };
}

/**
 * Create an XML content response for MCP tools and resources
 *
 * @param content - The XML content to return
 * @returns CallToolResult with XML text content and MIME type metadata
 *
 * @example
 * ```typescript
 * server.resource(
 *   { name: 'sitemap', uri: 'data://sitemap' },
 *   async () => xml('<?xml version="1.0"?><root>...</root>')
 * )
 * ```
 */
export function xml(content: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: content,
      },
    ],
    _meta: {
      mimeType: "text/xml",
    },
  };
}

/**
 * Create a CSS content response for MCP tools and resources
 *
 * @param content - The CSS content to return
 * @returns CallToolResult with CSS text content and MIME type metadata
 *
 * @example
 * ```typescript
 * server.resource(
 *   { name: 'styles', uri: 'asset://theme.css' },
 *   async () => css('body { margin: 0; }')
 * )
 * ```
 */
export function css(content: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: content,
      },
    ],
    _meta: {
      mimeType: "text/css",
    },
  };
}

/**
 * Create a JavaScript content response for MCP tools and resources
 *
 * @param content - The JavaScript content to return
 * @returns CallToolResult with JavaScript text content and MIME type metadata
 *
 * @example
 * ```typescript
 * server.resource(
 *   { name: 'script', uri: 'asset://main.js' },
 *   async () => javascript('console.log("Hello");')
 * )
 * ```
 */
export function javascript(content: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: content,
      },
    ],
    _meta: {
      mimeType: "text/javascript",
    },
  };
}

/**
 * Create a binary content response for MCP tools and resources
 *
 * @param base64Data - The base64-encoded binary data
 * @param mimeType - The MIME type of the binary content
 * @returns CallToolResult with binary content and MIME type metadata
 *
 * @example
 * ```typescript
 * server.resource(
 *   { name: 'document', uri: 'file://document.pdf' },
 *   async () => binary(base64PdfData, 'application/pdf')
 * )
 * ```
 */
export function binary(base64Data: string, mimeType: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: base64Data,
      },
    ],
    _meta: {
      mimeType,
      isBinary: true,
    },
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
  const structuredContent =
    results.find((result) => result.structuredContent) &&
    results
      .filter((result) => result.structuredContent)
      .map((result) => result.structuredContent)
      .reduce(
        (acc, result) => {
          return { ...acc, ...result };
        },
        {} as Record<string, unknown>
      );
  const _meta =
    results.find((result) => result._meta) &&
    results
      .filter((result) => result._meta)
      .map((result) => result._meta)
      .reduce(
        (acc, result) => {
          return { ...acc, ...result };
        },
        {} as Record<string, unknown>
      );
  return {
    content: results.flatMap((result) => result.content),
    ...(structuredContent && { structuredContent }),
    ...(_meta && { _meta }),
  };
}
