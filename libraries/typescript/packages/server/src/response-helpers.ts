import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Typed {@link CallToolResult} that constrains `structuredContent` to `T`.
 *
 * @deprecated Prefer returning a raw {@link CallToolResult} from tool
 * callbacks. Example: `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }`.
 *
 * @typeParam T - Structured payload type (typically an object).
 */
export interface TypedCallToolResult<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  [x: string]: unknown;
  content: CallToolResult["content"];
  isError?: CallToolResult["isError"];
  _meta?: CallToolResult["_meta"];
  structuredContent?: T;
}

/**
 * Content-only tool result (`structuredContent` pinned to `never`).
 *
 * @deprecated Prefer returning a raw {@link CallToolResult}:
 * `{ content: [{ type: "text", text }] }`.
 */
export interface ToolContentResult {
  [x: string]: unknown;
  content: CallToolResult["content"];
  isError?: CallToolResult["isError"];
  _meta?: CallToolResult["_meta"];
  structuredContent?: never;
}

/**
 * Create a plain-text tool result.
 *
 * @deprecated Prefer `{ content: [{ type: "text", text: content }] }`.
 *
 * @param content - Text to return.
 * @returns Tool result with a single text content block.
 *
 * @example
 * ```ts
 * // Preferred:
 * return { content: [{ type: "text", text: `Hello, ${name}!` }] };
 * // Deprecated:
 * return text(`Hello, ${name}!`);
 * ```
 */
export function text(content: string): ToolContentResult {
  return {
    content: [{ type: "text", text: content }],
    _meta: { mimeType: "text/plain" },
  };
}

/**
 * Create a Markdown text tool result.
 *
 * @deprecated Prefer `{ content: [{ type: "text", text: content }] }`.
 *
 * @param content - Markdown text.
 * @returns Tool result with `text/markdown` MIME metadata.
 */
export function markdown(content: string): ToolContentResult {
  return {
    content: [{ type: "text", text: content }],
    _meta: { mimeType: "text/markdown" },
  };
}

/**
 * Create an HTML text tool result.
 *
 * @deprecated Prefer `{ content: [{ type: "text", text: content }] }`.
 *
 * @param content - HTML text.
 * @returns Tool result with `text/html` MIME metadata.
 */
export function html(content: string): ToolContentResult {
  return {
    content: [{ type: "text", text: content }],
    _meta: { mimeType: "text/html" },
  };
}

/**
 * Create an XML text tool result.
 *
 * @deprecated Prefer `{ content: [{ type: "text", text: content }] }`.
 *
 * @param content - XML text.
 * @returns Tool result with `text/xml` MIME metadata.
 */
export function xml(content: string): ToolContentResult {
  return {
    content: [{ type: "text", text: content }],
    _meta: { mimeType: "text/xml" },
  };
}

/**
 * Create a CSS text tool result.
 *
 * @deprecated Prefer `{ content: [{ type: "text", text: content }] }`.
 *
 * @param content - CSS text.
 * @returns Tool result with `text/css` MIME metadata.
 */
export function css(content: string): ToolContentResult {
  return {
    content: [{ type: "text", text: content }],
    _meta: { mimeType: "text/css" },
  };
}

/**
 * Create a JavaScript text tool result.
 *
 * @deprecated Prefer `{ content: [{ type: "text", text: content }] }`.
 *
 * @param content - JavaScript source text.
 * @returns Tool result with `text/javascript` MIME metadata.
 */
export function javascript(content: string): ToolContentResult {
  return {
    content: [{ type: "text", text: content }],
    _meta: { mimeType: "text/javascript" },
  };
}

/**
 * Create an image content tool result.
 *
 * @deprecated Prefer
 * `{ content: [{ type: "image", data, mimeType }] }`.
 *
 * @param data - Base64 image data (or data URL payload).
 * @param mimeType - Image MIME type.
 * @returns Tool result with an image content block.
 *
 * @defaultValue mimeType - `"image/png"`
 */
export function image(
  data: string,
  mimeType: string = "image/png"
): ToolContentResult {
  return {
    content: [{ type: "image", data, mimeType }],
    _meta: { mimeType, isImage: true },
  };
}

/**
 * Create an audio content tool result from base64 data.
 *
 * @deprecated Prefer
 * `{ content: [{ type: "audio", data, mimeType }] }`.
 *
 * @param data - Base64-encoded audio.
 * @param mimeType - Audio MIME type.
 * @returns Tool result with an audio content block.
 *
 * @defaultValue mimeType - `"audio/wav"`
 */
export function audio(
  data: string,
  mimeType: string = "audio/wav"
): ToolContentResult {
  return {
    content: [{ type: "audio", data, mimeType }],
    _meta: { mimeType, isAudio: true },
  };
}

/**
 * Create a binary payload carried as base64 text.
 *
 * @deprecated Prefer a raw {@link CallToolResult} with an appropriate content
 * block, or a resource `{ contents: [{ uri, mimeType, blob }] }`.
 *
 * @param base64Data - Base64-encoded bytes.
 * @param mimeType - MIME type of the binary payload.
 * @returns Tool result with base64 text and binary MIME metadata.
 */
export function binary(
  base64Data: string,
  mimeType: string
): ToolContentResult {
  return {
    content: [{ type: "text", text: base64Data }],
    _meta: { mimeType, isBinary: true },
  };
}

/**
 * Create an embedded-resource content block for a tool result.
 *
 * Supports `resource(uri, mimeType, text?)` or `resource(uri, callToolResult)`.
 *
 * @deprecated Prefer
 * `{ content: [{ type: "resource", resource: { uri, mimeType, text } }] }`.
 *
 * @param uri - Resource URI.
 * @param mimeTypeOrContent - MIME type string, or a helper/`CallToolResult` to extract from.
 * @param text - Optional text body (3-arg form).
 * @returns Tool result with an embedded resource content block.
 */
export function resource(
  uri: string,
  mimeTypeOrContent: string | CallToolResult | TypedCallToolResult,
  text?: string
): ToolContentResult {
  if (
    typeof mimeTypeOrContent === "object" &&
    mimeTypeOrContent !== null &&
    "content" in mimeTypeOrContent
  ) {
    const contentResult = mimeTypeOrContent;
    let extractedText: string | undefined;
    let extractedMimeType: string | undefined;

    if (contentResult._meta && typeof contentResult._meta === "object") {
      const meta = contentResult._meta as Record<string, unknown>;
      if (typeof meta.mimeType === "string") {
        extractedMimeType = meta.mimeType;
      }
    }

    const first = contentResult.content?.[0];
    if (first?.type === "text" && "text" in first) {
      extractedText = first.text;
    }

    return {
      content: [
        {
          type: "resource",
          resource: {
            uri,
            ...(extractedMimeType !== undefined && {
              mimeType: extractedMimeType,
            }),
            text: extractedText ?? "",
          },
        },
      ],
    };
  }

  const mimeType = mimeTypeOrContent as string | undefined;
  return {
    content: [
      {
        type: "resource",
        resource: {
          uri,
          ...(mimeType !== undefined && mimeType !== "" && { mimeType }),
          text: text ?? "",
        },
      },
    ],
  };
}

/**
 * Create a failed tool result.
 *
 * @deprecated Prefer
 * `{ isError: true, content: [{ type: "text", text: message }] }`.
 *
 * @param message - Error message shown to the model.
 * @returns Tool result with `isError: true`.
 */
export function error(message: string): TypedCallToolResult<never> {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/**
 * Create a structured JSON object tool result.
 *
 * @deprecated Prefer
 * `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }`.
 *
 * @typeParam T - Object payload type.
 * @param data - Object (or array — forwarded to {@link array}) to return.
 * @returns Tool result with JSON text and `structuredContent`.
 */
export function object<T extends Record<string, unknown>>(
  data: T
): TypedCallToolResult<T> {
  if (Array.isArray(data)) {
    return array(data) as unknown as TypedCallToolResult<T>;
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
    _meta: { mimeType: "application/json" },
  };
}

/**
 * Create a structured array tool result (2026 any-JSON root — no `{ data }` wrap).
 *
 * @deprecated Prefer
 * `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }`
 * or `{ content: [], structuredContent: data }` (SDK may auto-append JSON text for
 * non-object roots).
 *
 * @typeParam T - Array payload type.
 * @param data - Array to return as `structuredContent`.
 * @returns Tool result with JSON text and the array as `structuredContent`.
 */
export function array<T extends unknown[]>(data: T): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

/**
 * Runtime data for a view-bound tool result (legacy widget helper).
 *
 * @deprecated Prefer returning a plain {@link CallToolResult} from a tool
 * registered with `view: { name }`. Put view props in `structuredContent` and
 * model-facing text in `content`.
 *
 * @typeParam TProps - Props object placed in `structuredContent`.
 */
export interface WidgetResponseConfig<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  /** View-facing data sent as `structuredContent`. */
  props?: TProps;
  /**
   * Legacy alias for {@link WidgetResponseConfig.props}.
   *
   * @deprecated Use `props` instead.
   */
  data?: TProps;
  /** Model-facing helper/`CallToolResult` whose `content` is forwarded. */
  output?: CallToolResult | TypedCallToolResult;
  /** Extra result `_meta` for the view. */
  metadata?: Record<string, unknown>;
  /** Override text when `output` is omitted or should be replaced. */
  message?: string;
}

/**
 * Create a view/widget tool result (`props` → `structuredContent`).
 *
 * @deprecated Prefer a plain {@link CallToolResult} with `view:` on the tool
 * definition:
 * `{ content: [{ type: "text", text }], structuredContent: props }`.
 *
 * @typeParam TProps - Props object type.
 * @param config - Runtime view data.
 * @returns Tool result with props in `structuredContent`.
 */
export function widget<
  TProps extends Record<string, unknown> = Record<string, unknown>,
>(config: WidgetResponseConfig<TProps>): TypedCallToolResult<TProps> {
  const props = config.props ?? config.data ?? ({} as TProps);
  const { output, message, metadata } = config;

  const finalContent = message
    ? [{ type: "text" as const, text: message }]
    : Array.isArray(output?.content) && output.content.length > 0
      ? output.content
      : [{ type: "text" as const, text: "" }];

  const result: CallToolResult = {
    content: finalContent,
  };

  if (metadata !== undefined && Object.keys(metadata).length > 0) {
    result._meta = metadata;
  }

  if (output?.structuredContent !== undefined) {
    result.structuredContent = output.structuredContent;
  } else if (Object.keys(props).length > 0) {
    result.structuredContent = props;
  }

  return result as unknown as TypedCallToolResult<TProps>;
}

/**
 * Merge several tool results into one (`content` concatenated; objects shallow-merged).
 *
 * @deprecated Prefer building a single raw {@link CallToolResult} with the
 * desired `content` array.
 *
 * @param results - Results to merge.
 * @returns Combined tool result.
 */
export function mix(...results: CallToolResult[]): CallToolResult {
  const withStructured = results.filter(
    (result) => result.structuredContent !== undefined
  );
  const structuredContent =
    withStructured.length > 0
      ? withStructured
          .map((result) => result.structuredContent)
          .reduce<Record<string, unknown>>(
            (acc, value) => ({
              ...acc,
              ...(typeof value === "object" && value !== null
                ? (value as Record<string, unknown>)
                : {}),
            }),
            {}
          )
      : undefined;

  const withMeta = results.filter((result) => result._meta !== undefined);
  const _meta =
    withMeta.length > 0
      ? withMeta
          .map((result) => result._meta)
          .reduce<Record<string, unknown>>(
            (acc, value) => ({
              ...acc,
              ...(value !== undefined
                ? (value as Record<string, unknown>)
                : {}),
            }),
            {}
          )
      : undefined;

  return {
    content: results.flatMap((result) => result.content),
    ...(structuredContent !== undefined &&
      Object.keys(structuredContent).length > 0 && { structuredContent }),
    ...(_meta !== undefined && Object.keys(_meta).length > 0 && { _meta }),
  };
}
