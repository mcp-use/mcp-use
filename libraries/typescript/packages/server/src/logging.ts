/**
 * Compact HTTP/MCP request logging.
 *
 * One summary line per HTTP request. MCP (JSON-RPC) requests use their
 * protocol method instead of the transport method:
 *
 * ```text
 * tools/call greet /mcp 200 client=raw-request/0.0.0 12ms
 * ```
 *
 * Three verbosity levels, resolved per request from the `MCP_USE_LOG_LEVEL`
 * environment variable (overriding any configured level):
 *
 * - `info` (default): the compact summary + detail lines only — no request
 *   or response payloads, so secrets in tool arguments/results stay out of
 *   production logs.
 * - `debug`: echoes compact truncated input/output on the detail line:
 *   `tools/call greet {"who":"world"} -> "hi world" raw-request/0.0.0`.
 * - `trace`: debug plus a full request/response dump (headers and bodies)
 *   after the summary.
 *
 * Credential-bearing routes marked sensitive by the framework always log
 * only the HTTP summary, even for malformed requests and at trace level.
 */
import {
  CLIENT_INFO_META_KEY,
  isJSONRPCRequest,
  type Implementation,
  type JSONRPCRequest,
  type RequestMethod,
  type RequestTypeMap,
} from "@modelcontextprotocol/server";

import {
  isBufferedResponse,
  trackBufferedResponse,
} from "./buffered-response.js";
import {
  getRequestBag,
  isSensitiveHttpRequest,
  type FetchMiddleware,
} from "./fetch-app.js";

/** Verbosity of the request logger. */
export type LogLevel = "info" | "debug" | "trace";

/** Options for {@link requestLogger} — the shape of `config.logging`. */
export interface LoggingOptions {
  /**
   * Whether request logging is on.
   *
   * @defaultValue `true`
   */
  enabled?: boolean;
  /**
   * Verbosity: `info` (compact lines without payloads, default), `debug`
   * (adds compact truncated input/output on the detail line), or `trace`
   * (debug plus full request/response header and body dumps). The
   * `MCP_USE_LOG_LEVEL` environment variable overrides this when set.
   * Embedded OAuth routes always log only method, path, status, and duration.
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
 * Effective log level: `MCP_USE_LOG_LEVEL` when it names a known level,
 * otherwise the configured level, otherwise `info`.
 */
function resolveLogLevel(configured?: LogLevel): LogLevel {
  const raw =
    typeof process === "undefined"
      ? undefined
      : process.env?.["MCP_USE_LOG_LEVEL"]?.toLowerCase();
  if (raw === "info" || raw === "debug" || raw === "trace") return raw;
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

/** Options for the standalone {@link requestLogger} middleware. */
export interface RequestLoggerOptions extends LoggingOptions {
  /**
   * MCP endpoint path. Only requests to this exact path are labelled with
   * their JSON-RPC method instead of their HTTP method.
   */
  mcpPath?: string;
  /** Source label used when colocated development services share stdout. */
  prefix?: string | undefined;
}

/**
 * Detail extractor for one protocol method: given the method's typed params,
 * return the subject and inline input to show, or `{}` when the method name
 * says it all.
 */
type DetailFormatter<M extends RequestMethod> = (
  params: RequestTypeMap[M]["params"]
) => McpDetail;

function formatClientInfo(
  info: Implementation | undefined
): string | undefined {
  if (info === undefined || typeof info.name !== "string") return undefined;
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

/** Resolve a client identity, including the legacy initialize handshake. */
function formatMcpClient(message: JSONRPCRequest): string | undefined {
  const modern = formatClientIdentity(message);
  if (modern !== undefined) return modern;
  if (message.method !== "initialize") return undefined;
  try {
    return formatClientInfo(
      (message.params as { clientInfo?: Implementation }).clientInfo
    );
  } catch {
    return undefined;
  }
}

/**
 * Strip control characters (newlines, ANSI escapes, …) from request-derived
 * strings so a hostile method/subject/error value cannot forge extra log
 * lines or terminal escape sequences.
 */
function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ");
}

/** Namespace color for the detail line's method segment. */
function methodStyle(method: string): Style {
  if (method.startsWith("tools/")) return cyan;
  if (method.startsWith("resources/")) return green;
  if (method.startsWith("prompts/")) return magenta;
  if (method === "initialize" || method === "ping") return gray;
  return blue;
}

interface RequestDescription {
  /** HTTP method, MCP method, or a compact batch method list. */
  method: string;
  /** Client identity for MCP traffic; omitted for HTTP-formatted requests. */
  client: string | undefined;
  /** First MCP request, used for subject and debug details. */
  mcpRequest: JSONRPCRequest | undefined;
  /** Whether reading the response would consume an open-ended stream. */
  streaming: boolean;
}

/** Classify one request before the handler runs. */
function describeRequest(
  httpMethod: string,
  pathname: string,
  mcpPath: string | undefined,
  body: unknown
): RequestDescription {
  if (pathname !== mcpPath) {
    return {
      method: httpMethod,
      client: undefined,
      mcpRequest: undefined,
      streaming: false,
    };
  }

  const requests = Array.isArray(body)
    ? body.filter(isJSONRPCRequest)
    : isJSONRPCRequest(body)
      ? [body]
      : [];
  const mcpRequest = requests[0];
  if (mcpRequest === undefined) {
    return {
      method: httpMethod,
      client: undefined,
      mcpRequest: undefined,
      streaming: false,
    };
  }

  const method =
    requests.length === 1
      ? sanitize(mcpRequest.method)
      : `batch(${requests.map((request) => sanitize(request.method)).join(",")})`;
  return {
    method,
    client: formatMcpClient(mcpRequest) ?? "unknown",
    mcpRequest,
    streaming: mcpRequest.method === "subscriptions/listen",
  };
}

/* ------------------------------------------------------------------------ *
 * Response outcome
 * ------------------------------------------------------------------------ */

/** Header names whose values are credentials and never worth dumping. */
const REDACTED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

/** Replace credential-bearing header values with a `[REDACTED]` marker. */
function redactHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      REDACTED_HEADERS.has(name.toLowerCase()) ? "[REDACTED]" : value,
    ])
  );
}

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
async function extractResponseOutcome(
  res: Response,
  request: Request
): Promise<ResponseOutcome> {
  if (!res.body) return { errorMessage: null };

  let text: string;
  try {
    const wasBuffered = isBufferedResponse(res, request);
    const clone = res.clone();
    // Cloning tees the body and changes its identity. Re-associate a
    // framework-buffered response so downstream adapters can still trust it.
    if (wasBuffered) trackBufferedResponse(request, res);
    text = await clone.text();
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
 * Trace dump
 * ------------------------------------------------------------------------ */

/** Pretty-print a value for the trace dump, truncating long strings. */
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

async function printTraceDump(
  response: Response,
  requestHeaders: Record<string, string>,
  requestBody: unknown,
  readResponseBody: boolean
): Promise<void> {
  console.log(`\n${cyan("=".repeat(80))}`);
  console.log(bold(cyan("[TRACE] Request Details")));
  console.log(cyan("-".repeat(80)));

  if (Object.keys(requestHeaders).length > 0) {
    console.log(yellow("Request Headers:"));
    console.log(formatForDump(redactHeaders(requestHeaders)));
  }
  if (requestBody !== undefined) {
    console.log(yellow("Request Body:"));
    console.log(
      typeof requestBody === "string" ? requestBody : formatForDump(requestBody)
    );
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  if (Object.keys(responseHeaders).length > 0) {
    console.log(yellow("Response Headers:"));
    console.log(formatForDump(redactHeaders(responseHeaders)));
  }

  if (!readResponseBody) {
    console.log(`${yellow("Response Body:")} (streaming — not dumped)`);
  } else if (response.body === null) {
    console.log(`${yellow("Response Body:")} (no body)`);
  } else {
    try {
      const text = await response.clone().text();
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

/** Cosmetic noise suppression for automatic browser favicon probes. */
function isNoisyRequest(httpMethod: string, pathname: string): boolean {
  if (httpMethod !== "GET" && httpMethod !== "HEAD") return false;
  return pathname.endsWith("/favicon.ico");
}

interface RequestLogLine {
  prefix: string | undefined;
  description: RequestDescription;
  detail: McpDetail | undefined;
  pathname: string;
  status: number;
  durationMs: number;
  suffix: string[];
}

/** Render the stable single-line field order in one place. */
function formatRequestLogLine(line: RequestLogLine): string {
  const { description, detail } = line;
  return [
    ...(line.prefix === undefined ? [] : [bold(line.prefix)]),
    methodStyle(description.method)(description.method),
    ...(detail?.subject === undefined ? [] : [bold(sanitize(detail.subject))]),
    line.pathname,
    styleStatus(line.status),
    ...(description.client === undefined
      ? []
      : [dim(`client=${sanitize(description.client)}`)]),
    dim(`${line.durationMs}ms`),
    ...line.suffix,
  ].join(" ");
}

/**
 * Fetch middleware logging every request in the compact single-line format (see
 * the module docs). `MCPServer` registers it automatically unless
 * `config.logging.enabled` is `false`.
 */
export function requestLogger(
  options: RequestLoggerOptions = {}
): FetchMiddleware {
  if (options.enabled === false) {
    return (_request, next) => next();
  }
  return async (request, next) => {
    const level = resolveLogLevel(options.level);
    const startedAt = Date.now();
    const httpMethod = request.method;
    const pathname = new URL(request.url).pathname;

    if (isNoisyRequest(httpMethod, pathname)) {
      return next();
    }

    // Credential-bearing routes must not have their payloads buffered or dumped.
    // The marker is applied by an outer framework middleware before logging.
    const sensitive = isSensitiveHttpRequest(request);
    const requestHeaders: Record<string, string> = {};
    if (!sensitive && level === "trace") {
      request.headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    }

    let requestBody: unknown;
    if (!sensitive && httpMethod !== "GET" && httpMethod !== "HEAD") {
      const parsedBody = getRequestBag(request).parsedBody;
      if (parsedBody !== undefined) {
        requestBody = parsedBody;
      } else {
        try {
          requestBody = await request.clone().json();
          if (
            (request.headers.get("content-type") ?? "").includes(
              "application/json"
            )
          ) {
            getRequestBag(request).parsedBody = requestBody;
          }
        } catch {
          // Non-JSON body — the summary line logs without MCP detail.
        }
      }
    }

    const description = describeRequest(
      httpMethod,
      pathname,
      options.mcpPath,
      requestBody
    );
    const logLine = (
      status: number,
      detail: McpDetail | undefined,
      suffix: string[] = []
    ): void => {
      console.log(
        formatRequestLogLine({
          prefix: options.prefix,
          description,
          detail,
          pathname,
          status,
          durationMs: Date.now() - startedAt,
          suffix,
        })
      );
    };

    let response: Response;
    try {
      response = await next();
    } catch (error) {
      logLine(500, undefined, [
        red(
          `ERROR ${sanitize(error instanceof Error ? error.message : String(error))}`
        ),
      ]);
      throw error;
    }
    const wasBuffered = isBufferedResponse(response, request);

    const detail =
      description.mcpRequest === undefined
        ? undefined
        : formatDetail(description.mcpRequest);
    const suffix: string[] = [];
    if (description.mcpRequest !== undefined && detail !== undefined) {
      const echoPayloads = level !== "info";
      if (echoPayloads && detail.input !== undefined) {
        suffix.push(inlineJson(detail.input));
      }
      const outcome: ResponseOutcome = description.streaming
        ? { errorMessage: null }
        : await extractResponseOutcome(response, request);
      if (
        echoPayloads &&
        description.mcpRequest.method === "tools/call" &&
        outcome.errorMessage === null &&
        outcome.result !== undefined
      ) {
        suffix.push(dim("->"), inlineJson(compactToolResult(outcome.result)));
      }
      if (outcome.errorMessage !== null) {
        suffix.push(red(`ERROR ${sanitize(outcome.errorMessage)}`));
      } else if (response.status >= 400) {
        suffix.push(red(`ERROR (HTTP ${response.status})`));
      }
    }

    logLine(response.status, detail, suffix);

    if (!sensitive && level === "trace") {
      await printTraceDump(
        response,
        requestHeaders,
        requestBody,
        !description.streaming
      );
    }

    // Cloning for logging tees the response stream. Preserve the known SDK
    // buffered contract using its new stream identity, but never promote an
    // unmarked custom or body-replacing response merely because it is JSON.
    return wasBuffered ? trackBufferedResponse(request, response) : response;
  };
}
