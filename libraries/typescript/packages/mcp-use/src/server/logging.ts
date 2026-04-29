import chalk from "chalk";
import type { Context, Next } from "hono";

import { getEnv } from "./utils/runtime.js";

/** If the rendered line would exceed this many plain characters, spill args to an indented second line. */
const MAX_INLINE_LENGTH = 160;
/** Cap error messages so a huge error body can't blow up the log line. */
const MAX_ERROR_MESSAGE_LENGTH = 200;
/** Cap the full rendered args JSON so one huge payload can't blow up the log line. */
const MAX_ARGS_TOTAL_LENGTH = 2000;
/** Truncate individual long strings in trace-mode body dumps. */
const MAX_TRACE_STRING_LENGTH = 100;
/** Stop descending into nested args past this depth. */
const MAX_ARG_DEPTH = 3;
/** Cap how many bytes of a POST /mcp response we peek for outcome detection. JSON-RPC error envelopes are tiny; large tool results are truncated and treated as `OK`. */
const MAX_RESPONSE_PEEK_BYTES = 64 * 1024;
/** Cap raw (non-JSON) trace-mode response body output. */
const MAX_TRACE_BODY_LENGTH = 10000;

const ANSI_PATTERN = /\x1B\[[0-9;]*m/g;
function visibleLength(s: string): number {
  return s.replace(ANSI_PATTERN, "").length;
}

/**
 * Verbosity tier for the request logger:
 * - `info`  — target, outcome, duration. Default. Hides args (which can carry PII/secrets).
 * - `debug` — `info` + inline args for `tools/call` and `prompts/get`.
 * - `trace` — `debug` + the verbose request/response header & body dump.
 */
export type LogLevel = "info" | "debug" | "trace";

/**
 * Resolve the effective log level from environment.
 *
 * Primary control is `MCP_LOG_LEVEL` (`info` | `debug` | `trace`, case-insensitive).
 * As a legacy fallback, a truthy `DEBUG` env var maps to `trace` so existing setups
 * that relied on `DEBUG=1` for the verbose body dump keep working. `MCP_LOG_LEVEL`
 * always wins when set; new docs and examples should reference it.
 *
 * Unset / unrecognized → `info`.
 */
export function getLogLevel(): LogLevel {
  const explicit = getEnv("MCP_LOG_LEVEL")?.toLowerCase();
  if (explicit === "info" || explicit === "debug" || explicit === "trace") {
    return explicit;
  }
  const debug = getEnv("DEBUG");
  if (
    debug !== undefined &&
    debug !== "" &&
    debug !== "0" &&
    debug.toLowerCase() !== "false"
  ) {
    return "trace";
  }
  return "info";
}

/**
 * Format an object for pretty-printed JSON logging (used by trace-mode body dumps).
 */
function formatForLogging(obj: any): string {
  function truncate(val: any): any {
    if (typeof val === "string" && val.length > MAX_TRACE_STRING_LENGTH) {
      return val.slice(0, MAX_TRACE_STRING_LENGTH) + "...";
    } else if (Array.isArray(val)) {
      return val.map(truncate);
    } else if (val && typeof val === "object") {
      const result: Record<string, any> = {};
      for (const key in val) {
        if (Object.prototype.hasOwnProperty.call(val, key)) {
          result[key] = truncate(val[key]);
        }
      }
      return result;
    }
    return val;
  }
  try {
    return JSON.stringify(truncate(obj), null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * Cap recursion depth for compact single-line arg rendering. Individual string values
 * are left intact — total output length is capped in `renderArgs` instead, so short
 * values (URLs, ids, messages) print whole and only genuinely huge payloads get clipped.
 */
function capDepth(val: any, depth = 0): any {
  if (depth >= MAX_ARG_DEPTH) {
    if (Array.isArray(val)) return val.length === 0 ? [] : ["..."];
    if (val && typeof val === "object") return "{...}";
    return val;
  }
  if (Array.isArray(val)) return val.map((v) => capDepth(v, depth + 1));
  if (val && typeof val === "object") {
    const result: Record<string, any> = {};
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        result[key] = capDepth(val[key], depth + 1);
      }
    }
    return result;
  }
  return val;
}

/**
 * Extract a human-readable target from a parsed JSON-RPC request body:
 * tool name for `tools/call`, resource URI for `resources/read`, client name/version
 * for `initialize`, etc. Returns null when the method has no natural target.
 */
export function extractTarget(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  const method: unknown = body.method;
  if (typeof method !== "string") return null;
  const params = body.params;
  switch (method) {
    case "initialize": {
      const info = params?.clientInfo;
      if (!info || typeof info !== "object") return null;
      const name = typeof info.name === "string" ? info.name : null;
      const version = typeof info.version === "string" ? info.version : null;
      if (name && version) return `${name}/${version}`;
      return name ?? version;
    }
    case "tools/call":
    case "prompts/get":
      return typeof params?.name === "string" ? params.name : null;
    case "resources/read":
    case "resources/subscribe":
    case "resources/unsubscribe":
      return typeof params?.uri === "string" ? params.uri : null;
    default:
      return null;
  }
}

/**
 * Render `params.arguments` as compact single-line JSON for `tools/call` / `prompts/get`.
 * Returns null for other methods, missing/empty arguments, or non-serializable values.
 */
export function renderArgs(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  if (body.method !== "tools/call" && body.method !== "prompts/get")
    return null;
  const args = body.params?.arguments;
  if (args === undefined || args === null) return null;
  if (typeof args !== "object") return null;
  if (
    Array.isArray(args) ? args.length === 0 : Object.keys(args).length === 0
  ) {
    return null;
  }
  let rendered: string;
  try {
    rendered = JSON.stringify(capDepth(args));
  } catch {
    return null;
  }
  if (rendered.length > MAX_ARGS_TOTAL_LENGTH) {
    return rendered.slice(0, MAX_ARGS_TOTAL_LENGTH) + "...<truncated>";
  }
  return rendered;
}

export type Outcome =
  | { kind: "ok" }
  | { kind: "rpc-error"; code: number | null; message: string }
  | { kind: "http"; status: number };

/**
 * Decide whether a POST /mcp request succeeded, returned a JSON-RPC error, reported
 * a tool-level error (`result.isError`), or failed at the HTTP layer.
 */
export function detectOutcome(
  statusCode: number,
  responseText: string | null
): Outcome {
  if (statusCode < 200 || statusCode >= 300) {
    return { kind: "http", status: statusCode };
  }
  if (!responseText) return { kind: "ok" };
  // First error wins for display across batch/SSE responses.
  for (const item of parseJsonRpcPayloads(responseText)) {
    if (!item || typeof item !== "object") continue;
    const env = item as { error?: any; result?: any };
    if (env.error && typeof env.error === "object") {
      return {
        kind: "rpc-error",
        code: typeof env.error.code === "number" ? env.error.code : null,
        message: truncateMessage(String(env.error.message ?? "unknown error")),
      };
    }
    const result = env.result;
    if (result && typeof result === "object" && result.isError === true) {
      const msg = extractToolErrorMessage(result) ?? "tool reported error";
      return { kind: "rpc-error", code: null, message: truncateMessage(msg) };
    }
  }
  return { kind: "ok" };
}

/**
 * Parse a POST /mcp response body into JSON-RPC envelopes. Handles three shapes:
 * - Plain JSON object (`{...}`) — when the client sent `Accept: application/json`.
 * - JSON-RPC batch array (`[{...}, ...]`).
 * - SSE event stream (`event: message\ndata: {...}\n\n`) — the default when
 *   clients accept `text/event-stream`, which official MCP clients do.
 *
 * Returns an empty array when nothing parseable is found; callers should fall
 * through to `ok` in that case.
 */
function parseJsonRpcPayloads(text: string): unknown[] {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trimStart();
    if (!payload) continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      // Ignore malformed data lines — partial frames or non-JSON keepalives.
    }
  }
  return out;
}

function extractToolErrorMessage(result: any): string | null {
  const content = result?.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (item && typeof item === "object" && typeof item.text === "string") {
      return item.text;
    }
  }
  return null;
}

function truncateMessage(msg: string): string {
  return msg.length > MAX_ERROR_MESSAGE_LENGTH
    ? msg.slice(0, MAX_ERROR_MESSAGE_LENGTH) + "..."
    : msg;
}

function renderOutcome(outcome: Outcome): string {
  switch (outcome.kind) {
    case "ok":
      return chalk.green("OK");
    case "rpc-error": {
      const codePart = outcome.code !== null ? ` ${outcome.code}` : "";
      return chalk.red(`ERROR${codePart} ${outcome.message}`);
    }
    case "http": {
      const text = `HTTP ${outcome.status}`;
      if (outcome.status >= 500) return chalk.magenta(text);
      if (outcome.status >= 300 && outcome.status < 400)
        return chalk.yellow(text);
      return chalk.red(text);
    }
  }
}

/**
 * Read up to `maxBytes` from a Response body, then cancel the stream. The returned
 * text may be a UTF-8-decoded prefix of the full body; callers must tolerate
 * truncated JSON (in which case `detectOutcome` falls back to `ok`). Reading from a
 * cloned response is required so the original body remains intact for the client.
 */
async function peekResponseText(
  response: Response,
  maxBytes: number
): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (total === 0) return null;
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= out.length) break;
    const space = out.length - offset;
    if (chunk.length <= space) {
      out.set(chunk, offset);
      offset += chunk.length;
    } else {
      out.set(chunk.subarray(0, space), offset);
      offset = out.length;
    }
  }
  return new TextDecoder().decode(out);
}

function colorHttpStatus(statusCode: number): string {
  const text = String(statusCode);
  if (statusCode >= 200 && statusCode < 300) return chalk.green(text);
  if (statusCode >= 300 && statusCode < 400) return chalk.yellow(text);
  if (statusCode >= 400 && statusCode < 500) return chalk.red(text);
  if (statusCode >= 500) return chalk.magenta(text);
  return text;
}

/**
 * Middleware that logs incoming HTTP requests with a timestamp, color-coded outcome,
 * duration, and (for POST /mcp) the JSON-RPC method + target + RPC-level error.
 *
 * Verbosity is controlled by `MCP_LOG_LEVEL` (or legacy `DEBUG`); see {@link getLogLevel}.
 * `debug` adds inline args; `trace` also dumps full request/response headers + bodies.
 *
 * Skips logging for inspector telemetry, inspector UI/assets, and SSE endpoints.
 *
 * @param c - Hono context for the current request/response
 * @param next - Next middleware function to invoke
 */
export async function requestLogger(c: Context, next: Next): Promise<void> {
  const timestamp = new Date().toISOString().substring(11, 23);
  const method = c.req.method;
  const logLevel = getLogLevel();
  const showArgs = logLevel === "debug" || logLevel === "trace";
  const traceMode = logLevel === "trace";

  // Filter out noisy endpoints that create log spam
  const pathname = c.req.path;
  const noisyPaths = [
    "/inspector/api/tel/", // Telemetry endpoints (posthog, scarf)
    "/inspector/api/rpc/stream", // RPC stream (SSE)
    "/inspector/api/rpc/log", // RPC log endpoint
    "/inspector", // Inspector UI and static assets
    "/mcp-use/widgets/", // Dev widget Vite proxy and assets
    "/mcp-use/public/", // Public static files
  ];
  // Also skip GET /mcp (SSE/health) and GET /inspector/api/* (API polling, dev-widget, etc.)
  const isNoisyGet =
    method === "GET" &&
    (pathname === "/mcp" ||
      pathname.startsWith("/inspector/api/") ||
      pathname.startsWith("/mcp-use/"));

  // Skip logging for noisy paths and noisy GETs but still process the request
  if (
    noisyPaths.some((noisyPath) => pathname.startsWith(noisyPath)) ||
    isNoisyGet
  ) {
    await next();
    return;
  }

  // Get request body for logging.
  // Parsing is gated to POST /mcp (where we need it for the line composition) and
  // trace mode (where the body dump applies to all routes). Other POST/PUT/PATCH
  // requests skip the parse so we don't double-buffer their bodies on every request.
  const isMcpPost = method === "POST" && pathname === "/mcp";
  let requestBody: any = null;
  let requestHeaders: Record<string, string> = {};

  if (traceMode) {
    const allHeaders = c.req.header();
    if (allHeaders) {
      requestHeaders = allHeaders;
    }
  }

  if ((isMcpPost || traceMode) && method !== "GET" && method !== "HEAD") {
    // Read text first so a failed JSON.parse can fall back to the raw string —
    // calling .json() then .text() on the same clone fails because .json()
    // consumes the body stream even when parsing throws.
    const text = await c.req.raw
      .clone()
      .text()
      .catch(() => null);
    if (text !== null && text.length > 0) {
      try {
        requestBody = JSON.parse(text);
      } catch {
        requestBody = text;
      }
    }
  }

  const startMs = performance.now();
  await next();
  const durationMs = Math.round(performance.now() - startMs);

  const statusCode = c.res.status;

  // Read response body for outcome detection (POST /mcp only — always JSON, never SSE).
  // In info/debug mode, cap at MAX_RESPONSE_PEEK_BYTES so a multi-MB tool result
  // doesn't get fully buffered just to inspect `result.isError`; truncated JSON falls
  // through to `ok`. In trace mode we read the full body once and reuse it for the
  // body dump below, avoiding a second clone.
  let responseText: string | null = null;
  if (isMcpPost) {
    try {
      const cloned = c.res.clone();
      responseText = traceMode
        ? await cloned.text().catch(() => null)
        : await peekResponseText(cloned, MAX_RESPONSE_PEEK_BYTES);
    } catch {
      // Ignore; outcome falls back to OK / HTTP status.
    }
  }

  // mcp-session-id lives in the request header for established sessions and in the
  // response header on the initialize round-trip.
  const sessionId =
    c.req.header("mcp-session-id") ??
    c.res.headers.get("mcp-session-id") ??
    null;
  const sessionTag = sessionId ? sessionId.slice(0, 7) : null;

  let line: string;

  if (isMcpPost && requestBody && typeof requestBody === "object") {
    const rpcMethod: string | undefined =
      typeof (requestBody as any).method === "string"
        ? (requestBody as any).method
        : undefined;
    const target = extractTarget(requestBody);
    const args = showArgs ? renderArgs(requestBody) : null;
    const outcome = detectOutcome(statusCode, responseText);

    const showSessionPrefix = sessionTag !== null && rpcMethod !== "initialize";
    const showSessionSuffix = sessionTag !== null && rpcMethod === "initialize";

    const sessionPrefix = showSessionPrefix
      ? chalk.dim(`sess=${sessionTag}`) + " "
      : "";
    const bracket = rpcMethod
      ? target
        ? " " + chalk.bold(`[${rpcMethod}: ${target}]`)
        : " " + chalk.bold(`[${rpcMethod}]`)
      : "";
    const sessionSuffix = showSessionSuffix
      ? " " + chalk.dim(`→ session=${sessionTag}`)
      : "";
    const head = `[${timestamp}] ${sessionPrefix}${method} ${chalk.bold(pathname)}${bracket}${sessionSuffix}`;
    const tail = ` ${renderOutcome(outcome)} ${chalk.dim(`(${durationMs}ms)`)}`;
    const argsPart = args !== null ? ` args=${args}` : "";
    const argsOnNewLine =
      args !== null &&
      visibleLength(head + argsPart + tail) > MAX_INLINE_LENGTH;

    if (argsOnNewLine) {
      line = `${head}${tail}\n    args=${args}`;
    } else {
      line = `${head}${argsPart}${tail}`;
    }
  } else {
    line = `[${timestamp}] ${method} ${chalk.bold(pathname)} ${colorHttpStatus(statusCode)} ${chalk.dim(`(${durationMs}ms)`)}`;
  }

  console.log(line);

  if (traceMode) {
    console.log("\n" + chalk.cyan("=".repeat(80)));
    console.log(chalk.bold.cyan("[TRACE] Request Details"));
    console.log(chalk.cyan("-".repeat(80)));

    if (Object.keys(requestHeaders).length > 0) {
      console.log(chalk.yellow("Request Headers:"));
      console.log(formatForLogging(requestHeaders));
    }

    if (requestBody !== null) {
      console.log(chalk.yellow("Request Body:"));
      console.log(
        typeof requestBody === "string"
          ? requestBody
          : formatForLogging(requestBody)
      );
    }

    const responseHeaders: Record<string, string> = {};
    c.res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    if (Object.keys(responseHeaders).length > 0) {
      console.log(chalk.yellow("Response Headers:"));
      console.log(formatForLogging(responseHeaders));
    }

    // Reuse the response text already read above for MCP routes; for other
    // traced routes, clone and read the body now.
    let traceBody: string | null = responseText;
    if (traceBody === null && c.res.body) {
      traceBody = await c.res
        .clone()
        .text()
        .catch(() => null);
    }
    console.log(chalk.yellow("Response Body:"));
    if (traceBody === null || traceBody.length === 0) {
      console.log("(empty)");
    } else {
      try {
        console.log(formatForLogging(JSON.parse(traceBody)));
      } catch {
        if (traceBody.length > MAX_TRACE_BODY_LENGTH) {
          console.log(
            traceBody.slice(0, MAX_TRACE_BODY_LENGTH) +
              `\n... (truncated, ${traceBody.length - MAX_TRACE_BODY_LENGTH} more characters)`
          );
        } else {
          console.log(traceBody);
        }
      }
    }

    console.log(chalk.cyan("=".repeat(80)) + "\n");
  }
}
