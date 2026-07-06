/**
 * Compact HTTP/MCP request logging.
 *
 * One summary line per HTTP request, plus an indented detail line for MCP
 * (JSON-RPC) requests naming the protocol method, its subject (tool name,
 * resource URI, prompt name), compact truncated input/output, and the
 * calling client:
 *
 * ```text
 * 12:45:01 POST /mcp 200 in 12ms
 *   tools/call greet {"who":"world"} -> "hi world" raw-request/0.0.0
 * ```
 *
 * Detail lines are plain two-space-indented ASCII (no box-drawing glyphs) so
 * log parsers and agents can tell the two apart mechanically: summary lines
 * start with a timestamp, detail lines start with whitespace.
 *
 * Two verbosity levels, resolved per request from the `MCP_USE_LOG_LEVEL`
 * environment variable (overriding any configured level):
 *
 * - `info` (default): the compact summary + detail lines only.
 * - `debug`: adds a full request/response dump (headers and bodies) after the
 *   summary. `trace` is accepted as an alias for `debug` (the v1 name).
 */
import {
  CLIENT_INFO_META_KEY,
  isJSONRPCRequest,
  type Implementation,
  type JSONRPCRequest,
  type RequestMethod,
  type RequestTypeMap,
} from "@modelcontextprotocol/server";
import type { Context, MiddlewareHandler } from "hono";

/** Verbosity of the request logger. */
export type LogLevel = "info" | "debug";

/** Options for {@link requestLogger} — the shape of `config.logging`. */
export interface LoggingOptions {
  /**
   * Whether request logging is on.
   *
   * @defaultValue `true`
   */
  enabled?: boolean;
  /**
   * Verbosity: `info` (compact lines, default) or `debug` (adds full
   * request/response header and body dumps). The `MCP_USE_LOG_LEVEL`
   * environment variable overrides this when set.
   */
  level?: LogLevel;
}

/* ------------------------------------------------------------------------ *
 * ANSI styling (no color-library dependency)
 * ------------------------------------------------------------------------ */

/**
 * Whether to emit ANSI escapes: only on a TTY stdout, and never when the
 * `NO_COLOR` convention is set. Edge runtimes without `process.stdout`
 * (Workers, Deno Deploy) get plain text.
 */
function colorsEnabled(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env?.["NO_COLOR"] !== undefined) return false;
  return process.stdout?.isTTY === true;
}

type Style = (text: string) => string;

function ansi(open: number, close: number): Style {
  return (text) =>
    colorsEnabled() ? `\u001B[${open}m${text}\u001B[${close}m` : text;
}

const bold = ansi(1, 22);
const dim = ansi(2, 22);
const red = ansi(31, 39);
const green = ansi(32, 39);
const yellow = ansi(33, 39);
const blue = ansi(34, 39);
const magenta = ansi(35, 39);
const cyan = ansi(36, 39);
const gray = ansi(90, 39);

/* ------------------------------------------------------------------------ *
 * Level resolution
 * ------------------------------------------------------------------------ */

/**
 * Effective log level: `MCP_USE_LOG_LEVEL` when it names a known level
 * (`trace` — the v1 name for the dump tier — maps to `debug`), otherwise the
 * configured level, otherwise `info`.
 */
export function resolveLogLevel(configured?: LogLevel): LogLevel {
  const raw =
    typeof process === "undefined"
      ? undefined
      : process.env?.["MCP_USE_LOG_LEVEL"]?.toLowerCase();
  if (raw === "debug" || raw === "trace") return "debug";
  if (raw === "info") return "info";
  return configured ?? "info";
}

/* ------------------------------------------------------------------------ *
 * MCP detail formatting (typed against the SDK's protocol method surface)
 * ------------------------------------------------------------------------ */

/** What one protocol method contributes to the detail line. */
interface McpDetail {
  /** Short subject next to the method name (tool name, resource URI, …). */
  subject?: string | undefined;
  /** Caller-provided input worth echoing inline (tool/prompt arguments). */
  input?: unknown;
}

/**
 * Detail extractor for one protocol method: given the method's typed params,
 * return the subject and inline input to show, or `{}` when the method name
 * says it all.
 */
type DetailFormatter<M extends RequestMethod> = (
  params: RequestTypeMap[M]["params"]
) => McpDetail;

function formatClientInfo(info: Implementation | undefined): string | undefined {
  if (info === undefined) return undefined;
  return typeof info.version === "string" && info.version !== ""
    ? `${info.name}/${info.version}`
    : info.name;
}

/**
 * Exhaustive over {@link RequestMethod}: adding a protocol method to the SDK
 * makes this table a compile error until a formatter is chosen — the inverse
 * of v1's silent `[unknown-method]` fallback.
 */
const detailFormatters: {
  [M in RequestMethod]: DetailFormatter<M>;
} = {
  initialize: (p) => ({ subject: formatClientInfo(p.clientInfo) }),
  ping: () => ({}),
  "server/discover": () => ({}),
  "completion/complete": (p) => ({
    subject: p.ref.type === "ref/prompt" ? p.ref.name : p.ref.uri,
    input: p.argument,
  }),
  "logging/setLevel": (p) => ({ subject: p.level }),
  "prompts/get": (p) => ({ subject: p.name, input: p.arguments }),
  "prompts/list": () => ({}),
  "resources/list": () => ({}),
  "resources/templates/list": () => ({}),
  "resources/read": (p) => ({ subject: p.uri }),
  "resources/subscribe": (p) => ({ subject: p.uri }),
  "resources/unsubscribe": (p) => ({ subject: p.uri }),
  "subscriptions/listen": () => ({}),
  "tools/call": (p) => ({ subject: p.name, input: p.arguments }),
  "tools/list": () => ({}),
  "sampling/createMessage": () => ({}),
  "elicitation/create": () => ({}),
  "roots/list": () => ({}),
};

function isKnownMethod(method: string): method is RequestMethod {
  return Object.prototype.hasOwnProperty.call(detailFormatters, method);
}

/**
 * Detail for a guard-proved JSON-RPC request. The guard proves the JSON-RPC
 * envelope, not method-specific params, so the formatter call is fenced: a
 * malformed body (which the SDK will reject downstream anyway) logs without
 * a subject rather than throwing here.
 */
function formatDetail(message: JSONRPCRequest): McpDetail {
  if (!isKnownMethod(message.method)) return {};
  try {
    const formatter = detailFormatters[message.method] as (
      params: unknown
    ) => McpDetail;
    const detail = formatter(message.params);
    return typeof detail.subject === "string" || detail.subject === undefined
      ? detail
      : {};
  } catch {
    return {};
  }
}

/** Longest inline JSON segment (input or output) before truncation. */
const INLINE_JSON_MAX_LENGTH = 80;

/**
 * Compact single-line JSON for inline input/output echoing, truncated to
 * {@link INLINE_JSON_MAX_LENGTH} characters.
 */
function inlineJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > INLINE_JSON_MAX_LENGTH
    ? `${text.slice(0, INLINE_JSON_MAX_LENGTH)}...`
    : text;
}

/**
 * Client identity from the per-request `_meta` envelope every 2026-07-28
 * request carries (`io.modelcontextprotocol/clientInfo`) — the stateless
 * replacement for v1's session-id prefix. `undefined` for requests without
 * the envelope (legacy-era traffic).
 */
function formatClientIdentity(message: JSONRPCRequest): string | undefined {
  const meta = message.params?._meta;
  if (meta === undefined) return undefined;
  const info = (meta as Record<string, unknown>)[CLIENT_INFO_META_KEY];
  if (
    typeof info !== "object" ||
    info === null ||
    typeof (info as Implementation).name !== "string"
  ) {
    return undefined;
  }
  return formatClientInfo(info as Implementation);
}

/** Namespace color for the detail line's method segment. */
function methodStyle(method: string): Style {
  if (method.startsWith("tools/")) return cyan;
  if (method.startsWith("resources/")) return green;
  if (method.startsWith("prompts/")) return magenta;
  if (method === "initialize" || method === "ping") return gray;
  return blue;
}

/* ------------------------------------------------------------------------ *
 * Response outcome
 * ------------------------------------------------------------------------ */

/** The JSON-RPC-level outcome parsed from a response body. */
interface ResponseOutcome {
  /** Error message when the exchange failed (JSON-RPC error or tool error). */
  errorMessage: string | null;
  /** The JSON-RPC `result` payload when the exchange succeeded. */
  result?: unknown;
}

/**
 * Parse the JSON-RPC outcome from the response body: an error message from
 * the error envelope (`{ error: { message } }`) or a tool-call error
 * (`{ result: { isError: true, content: [{ text }] } }`), otherwise the
 * successful `result` payload. Handles both `application/json` and
 * `text/event-stream` bodies.
 */
async function extractResponseOutcome(res: Response): Promise<ResponseOutcome> {
  if (!res.body) return { errorMessage: null };

  let text: string;
  try {
    text = await res.clone().text();
  } catch {
    return { errorMessage: null };
  }
  if (!text) return { errorMessage: null };

  const isSse = (res.headers.get("content-type") ?? "").includes(
    "text/event-stream"
  );
  const payloads: unknown[] = [];
  const tryParse = (raw: string) => {
    try {
      payloads.push(JSON.parse(raw));
    } catch {
      // not JSON — skip
    }
  };
  if (isSse) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data) tryParse(data);
      }
    }
  } else {
    tryParse(text);
  }

  let result: unknown;
  for (const payload of payloads) {
    if (payload === null || typeof payload !== "object") continue;
    const message = payload as {
      error?: { message?: unknown };
      result?: { isError?: unknown; content?: unknown };
    };
    if (typeof message.error?.message === "string") {
      return { errorMessage: message.error.message };
    }
    if (message.result?.isError === true) {
      const blocks = Array.isArray(message.result.content)
        ? (message.result.content as { type?: unknown; text?: unknown }[])
        : [];
      const textBlock = blocks.find(
        (b) => b?.type === "text" && typeof b.text === "string"
      );
      return {
        errorMessage: textBlock ? String(textBlock.text) : "tool error",
      };
    }
    if ("result" in message) result = message.result;
  }
  return { errorMessage: null, result };
}

/**
 * Compact view of a successful `tools/call` result for inline echoing:
 * `structuredContent` when present, a lone text block's text, or the raw
 * content blocks.
 */
function compactToolResult(result: unknown): unknown {
  if (result === null || typeof result !== "object") return result;
  const { structuredContent, content } = result as {
    structuredContent?: unknown;
    content?: unknown;
  };
  if (structuredContent !== undefined) return structuredContent;
  if (Array.isArray(content)) {
    const [block] = content as { type?: unknown; text?: unknown }[];
    if (content.length === 1 && block?.type === "text") return block.text;
  }
  return content;
}

/* ------------------------------------------------------------------------ *
 * Debug dump
 * ------------------------------------------------------------------------ */

/** Pretty-print a value for the debug dump, truncating long strings. */
function formatForDump(value: unknown): string {
  function truncate(val: unknown): unknown {
    if (typeof val === "string" && val.length > 100) {
      return `${val.slice(0, 100)}...`;
    }
    if (Array.isArray(val)) return val.map(truncate);
    if (val !== null && typeof val === "object") {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).map(([k, v]) => [
          k,
          truncate(v),
        ])
      );
    }
    return val;
  }
  try {
    return JSON.stringify(truncate(value), null, 2);
  } catch {
    return String(value);
  }
}

const DUMP_BODY_MAX_LENGTH = 10_000;

async function printDebugDump(
  c: Context,
  requestHeaders: Record<string, string>,
  requestBody: unknown,
  readResponseBody: boolean
): Promise<void> {
  console.log(`\n${cyan("=".repeat(80))}`);
  console.log(bold(cyan("[DEBUG] Request Details")));
  console.log(cyan("-".repeat(80)));

  if (Object.keys(requestHeaders).length > 0) {
    console.log(yellow("Request Headers:"));
    console.log(formatForDump(requestHeaders));
  }
  if (requestBody !== undefined) {
    console.log(yellow("Request Body:"));
    console.log(
      typeof requestBody === "string" ? requestBody : formatForDump(requestBody)
    );
  }

  const responseHeaders: Record<string, string> = {};
  c.res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  if (Object.keys(responseHeaders).length > 0) {
    console.log(yellow("Response Headers:"));
    console.log(formatForDump(responseHeaders));
  }

  if (!readResponseBody) {
    console.log(`${yellow("Response Body:")} (streaming — not dumped)`);
  } else if (c.res.body === null) {
    console.log(`${yellow("Response Body:")} (no body)`);
  } else {
    try {
      const text = await c.res.clone().text();
      if (text.length === 0) {
        console.log(`${yellow("Response Body:")} (empty)`);
      } else {
        console.log(yellow("Response Body:"));
        try {
          console.log(formatForDump(JSON.parse(text)));
        } catch {
          console.log(
            text.length > DUMP_BODY_MAX_LENGTH
              ? `${text.slice(0, DUMP_BODY_MAX_LENGTH)}\n... (truncated, ${
                  text.length - DUMP_BODY_MAX_LENGTH
                } more characters)`
              : text
          );
        }
      }
    } catch {
      console.log(`${yellow("Response Body:")} (unable to read)`);
    }
  }

  console.log(`${cyan("=".repeat(80))}\n`);
}

/* ------------------------------------------------------------------------ *
 * Middleware
 * ------------------------------------------------------------------------ */

/** Style an HTTP status code by its class. */
function styleStatus(status: number): string {
  const text = String(status);
  if (status >= 500) return magenta(text);
  if (status >= 400) return red(text);
  if (status >= 300) return yellow(text);
  return green(text);
}

/**
 * Cosmetic noise suppression: inspector shell page loads and favicon probes
 * add nothing to a request log.
 */
function isNoisyRequest(httpMethod: string, pathname: string): boolean {
  if (httpMethod !== "GET" && httpMethod !== "HEAD") return false;
  return pathname.includes("/inspector") || pathname.endsWith("/favicon.ico");
}

/**
 * Hono middleware logging every request in the compact two-line format (see
 * the module docs). Register it on the app the MCP endpoint is mounted on;
 * `MCPServer` does so automatically unless `config.logging.enabled` is
 * `false`.
 */
export function requestLogger(options: LoggingOptions = {}): MiddlewareHandler {
  if (options.enabled === false) {
    return (_c, next) => next();
  }
  return async (c, next) => {
    const level = resolveLogLevel(options.level);
    const startedAt = Date.now();
    const httpMethod = c.req.method;
    const pathname = new URL(c.req.url).pathname;

    if (isNoisyRequest(httpMethod, pathname)) {
      await next();
      return;
    }

    const requestHeaders: Record<string, string> =
      level === "debug" ? c.req.header() : {};

    // Body: prefer the parsed body createMcpHonoApp's JSON middleware stashed
    // in context vars (a request body is only readable once); fall back to
    // cloning on bare apps where that middleware is absent.
    let requestBody: unknown;
    if (httpMethod !== "GET" && httpMethod !== "HEAD") {
      const parsedBody = (c.var as Record<string, unknown>)["parsedBody"];
      if (parsedBody !== undefined) {
        requestBody = parsedBody;
      } else {
        try {
          requestBody = await c.req.raw.clone().json();
        } catch {
          // Non-JSON body — the summary line logs without MCP detail.
        }
      }
    }

    await next();

    const durationMs = Date.now() - startedAt;
    const timestamp = new Date().toISOString().substring(11, 19);
    const mcpRequest = isJSONRPCRequest(requestBody) ? requestBody : undefined;

    // Long-lived streams (subscriptions/listen keeps its SSE stream open
    // indefinitely) must not be awaited for an outcome — reading the full
    // body would block the log line, and the middleware chain, forever.
    const isStreamingMethod = mcpRequest?.method === "subscriptions/listen";

    const lines: string[] = [
      [
        dim(timestamp),
        bold(httpMethod),
        pathname,
        styleStatus(c.res.status),
        dim(`in ${durationMs}ms`),
      ].join(" "),
    ];

    if (mcpRequest !== undefined) {
      const parts: string[] = [
        `  ${methodStyle(mcpRequest.method)(mcpRequest.method)}`,
      ];
      const detail = formatDetail(mcpRequest);
      if (detail.subject !== undefined) parts.push(bold(detail.subject));
      if (detail.input !== undefined) parts.push(inlineJson(detail.input));
      const outcome: ResponseOutcome = isStreamingMethod
        ? { errorMessage: null }
        : await extractResponseOutcome(c.res);
      // Echo tool output inline (truncated): the one result callers reliably
      // want to glance at. Resource/prompt payloads are bulk content — the
      // debug dump covers those.
      if (
        mcpRequest.method === "tools/call" &&
        outcome.errorMessage === null &&
        outcome.result !== undefined
      ) {
        parts.push(dim("->"), inlineJson(compactToolResult(outcome.result)));
      }
      // The initialize subject *is* the client identity — don't repeat it.
      if (mcpRequest.method !== "initialize") {
        const client = formatClientIdentity(mcpRequest);
        if (client !== undefined) parts.push(dim(client));
      }
      if (outcome.errorMessage !== null) {
        parts.push(red(`ERROR ${outcome.errorMessage}`));
      } else if (c.res.status >= 400) {
        parts.push(red(`ERROR (HTTP ${c.res.status})`));
      }
      lines.push(parts.join(" "));
    }

    // One console.log per request keeps the pair atomic under concurrency.
    console.log(lines.join("\n"));

    if (level === "debug") {
      await printDebugDump(c, requestHeaders, requestBody, !isStreamingMethod);
    }
  };
}
