import chalk from "chalk";
import type { Context, Next } from "hono";

import { getEnv } from "./utils/runtime.js";

/** If the rendered line would exceed this many plain characters, spill args to an indented second line. */
const MAX_INLINE_LENGTH = 160;
/** Cap error messages so a huge error body can't blow up the log line. */
const MAX_ERROR_MESSAGE_LENGTH = 200;
/** Truncate individual string values inside rendered args. */
const MAX_ARG_STRING_LENGTH = 100;
/** Stop descending into nested args past this depth. */
const MAX_ARG_DEPTH = 3;

/**
 * Check if DEBUG mode is enabled via environment variable
 */
function isDebugMode(): boolean {
  const debugEnv = getEnv("DEBUG");
  return (
    debugEnv !== undefined &&
    debugEnv !== "" &&
    debugEnv !== "0" &&
    debugEnv.toLowerCase() !== "false"
  );
}

/**
 * Format an object for pretty-printed JSON logging (used by DEBUG-mode body dumps).
 */
function formatForLogging(obj: any): string {
  function truncate(val: any): any {
    if (typeof val === "string" && val.length > MAX_ARG_STRING_LENGTH) {
      return val.slice(0, MAX_ARG_STRING_LENGTH) + "...";
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
 * Deeply truncate long strings and cap recursion for compact single-line arg rendering.
 */
function truncateCompact(val: any, depth = 0): any {
  if (typeof val === "string" && val.length > MAX_ARG_STRING_LENGTH) {
    return val.slice(0, MAX_ARG_STRING_LENGTH) + "...";
  }
  if (depth >= MAX_ARG_DEPTH) {
    if (Array.isArray(val)) return val.length === 0 ? [] : ["..."];
    if (val && typeof val === "object") return "{...}";
    return val;
  }
  if (Array.isArray(val)) return val.map((v) => truncateCompact(v, depth + 1));
  if (val && typeof val === "object") {
    const result: Record<string, any> = {};
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        result[key] = truncateCompact(val[key], depth + 1);
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
  try {
    return JSON.stringify(truncateCompact(args));
  } catch {
    return null;
  }
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
  let body: any;
  try {
    body = JSON.parse(responseText);
  } catch {
    return { kind: "ok" };
  }
  // JSON-RPC batch responses come back as arrays; the first error wins for display.
  const items = Array.isArray(body) ? body : [body];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.error && typeof item.error === "object") {
      return {
        kind: "rpc-error",
        code: typeof item.error.code === "number" ? item.error.code : null,
        message: truncateMessage(String(item.error.message ?? "unknown error")),
      };
    }
    const result = item.result;
    if (result && typeof result === "object" && result.isError === true) {
      const msg = extractToolErrorMessage(result) ?? "tool reported error";
      return { kind: "rpc-error", code: null, message: truncateMessage(msg) };
    }
  }
  return { kind: "ok" };
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

function plainOutcome(outcome: Outcome): string {
  switch (outcome.kind) {
    case "ok":
      return "OK";
    case "rpc-error":
      return `ERROR${outcome.code !== null ? ` ${outcome.code}` : ""} ${outcome.message}`;
    case "http":
      return `HTTP ${outcome.status}`;
    default:
      return "";
  }
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
    default:
      return "";
  }
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
 * duration, and (for POST /mcp) the JSON-RPC method + target + args + RPC-level error.
 *
 * Skips logging for inspector telemetry, inspector UI/assets, and SSE endpoints.
 * When DEBUG is enabled, also logs request headers/body and response headers/body.
 *
 * @param c - Hono context for the current request/response
 * @param next - Next middleware function to invoke
 */
export async function requestLogger(c: Context, next: Next): Promise<void> {
  const timestamp = new Date().toISOString().substring(11, 23);
  const method = c.req.method;
  const url = c.req.url;
  const debugMode = isDebugMode();

  // Filter out noisy endpoints that create log spam
  const pathname = new URL(url).pathname;
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

  // Get request body for logging
  let requestBody: any = null;
  let requestHeaders: Record<string, string> = {};

  if (debugMode) {
    // Log request headers - c.req.header() without args returns all headers
    const allHeaders = c.req.header();
    if (allHeaders) {
      requestHeaders = allHeaders;
    }
  }

  // Get request body (for MCP method logging or full debug logging)
  if (method !== "GET" && method !== "HEAD") {
    try {
      // Clone the request to avoid consuming the original body stream
      const clonedRequest = c.req.raw.clone();
      requestBody = await clonedRequest.json().catch(() => {
        // If JSON parsing fails, try to get as text
        return clonedRequest.text().catch(() => null);
      });
    } catch {
      // Ignore errors
    }
  }

  const startMs = performance.now();
  await next();
  const durationMs = Math.round(performance.now() - startMs);

  const statusCode = c.res.status;
  const isMcpPost = method === "POST" && url.includes("/mcp");

  // Peek response body for outcome detection (POST /mcp only — always JSON, never SSE).
  // Safe to .text() because GET /mcp (SSE) is already filtered out above.
  let responseText: string | null = null;
  if (isMcpPost) {
    try {
      const cloned = c.res.clone();
      responseText = await cloned.text().catch(() => null);
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
    const args = renderArgs(requestBody);
    const outcome = detectOutcome(statusCode, responseText);

    const showSessionPrefix = sessionTag !== null && rpcMethod !== "initialize";
    const showSessionSuffix = sessionTag !== null && rpcMethod === "initialize";

    // Plain (color-free) parts — used to decide whether args spill to a second line.
    const sessionPrefixPlain = showSessionPrefix ? `sess=${sessionTag} ` : "";
    const bracketPlain = rpcMethod
      ? target
        ? ` [${rpcMethod}: ${target}]`
        : ` [${rpcMethod}]`
      : "";
    const sessionSuffixPlain = showSessionSuffix
      ? ` → session=${sessionTag}`
      : "";
    const headPlain = `[${timestamp}] ${sessionPrefixPlain}${method} ${pathname}${bracketPlain}${sessionSuffixPlain}`;
    const argsPlain = args ? ` args=${args}` : "";
    const tailPlain = ` ${plainOutcome(outcome)} (${durationMs}ms)`;
    const argsOnNewLine =
      args !== null &&
      headPlain.length + argsPlain.length + tailPlain.length >
        MAX_INLINE_LENGTH;

    // Rendered (colored) parts.
    const sessionPrefixRendered = showSessionPrefix
      ? chalk.dim(`sess=${sessionTag}`) + " "
      : "";
    const bracketRendered = rpcMethod
      ? target
        ? " " + chalk.bold(`[${rpcMethod}: ${target}]`)
        : " " + chalk.bold(`[${rpcMethod}]`)
      : "";
    const sessionSuffixRendered = showSessionSuffix
      ? " " + chalk.dim(`→ session=${sessionTag}`)
      : "";
    const head = `[${timestamp}] ${sessionPrefixRendered}${method} ${chalk.bold(pathname)}${bracketRendered}${sessionSuffixRendered}`;
    const outcomeRendered = renderOutcome(outcome);
    const durationRendered = chalk.dim(`(${durationMs}ms)`);

    if (args !== null && argsOnNewLine) {
      line = `${head} ${outcomeRendered} ${durationRendered}\n    args: ${args}`;
    } else if (args !== null) {
      line = `${head} args=${args} ${outcomeRendered} ${durationRendered}`;
    } else {
      line = `${head} ${outcomeRendered} ${durationRendered}`;
    }
  } else {
    line = `[${timestamp}] ${method} ${chalk.bold(pathname)} ${colorHttpStatus(statusCode)} ${chalk.dim(`(${durationMs}ms)`)}`;
  }

  console.log(line);

  // Debug mode: log detailed request/response information
  if (debugMode) {
    console.log("\n" + chalk.cyan("=".repeat(80)));
    console.log(chalk.bold.cyan("[DEBUG] Request Details"));
    console.log(chalk.cyan("-".repeat(80)));

    // Request headers
    if (Object.keys(requestHeaders).length > 0) {
      console.log(chalk.yellow("Request Headers:"));
      console.log(formatForLogging(requestHeaders));
    }

    // Request body
    if (requestBody !== null) {
      console.log(chalk.yellow("Request Body:"));
      if (typeof requestBody === "string") {
        console.log(requestBody);
      } else {
        console.log(formatForLogging(requestBody));
      }
    }

    // Response headers
    const responseHeaders: Record<string, string> = {};
    c.res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    if (Object.keys(responseHeaders).length > 0) {
      console.log(chalk.yellow("Response Headers:"));
      console.log(formatForLogging(responseHeaders));
    }

    // Response body
    try {
      // Check if response has a body and can be cloned
      // Clone the response to read the body without consuming the original stream
      // This ensures the original response remains intact for the client
      if (c.res.body !== null && c.res.body !== undefined) {
        try {
          const clonedResponse = c.res.clone();
          const responseBody = await clonedResponse.text().catch(() => null);

          if (responseBody !== null && responseBody.length > 0) {
            console.log(chalk.yellow("Response Body:"));
            // Try to parse as JSON for pretty printing
            try {
              const jsonBody = JSON.parse(responseBody);
              console.log(formatForLogging(jsonBody));
            } catch {
              // Not JSON, print as text (truncate if too long)
              const maxLength = 10000;
              if (responseBody.length > maxLength) {
                console.log(
                  responseBody.substring(0, maxLength) +
                    `\n... (truncated, ${responseBody.length - maxLength} more characters)`
                );
              } else {
                console.log(responseBody);
              }
            }
          } else {
            console.log(chalk.yellow("Response Body:") + " (empty)");
          }
        } catch (cloneError) {
          // If cloning fails (e.g., response already consumed), log that
          console.log(
            chalk.yellow("Response Body:") + " (unable to clone/read)"
          );
        }
      } else {
        console.log(chalk.yellow("Response Body:") + " (no body)");
      }
    } catch (error) {
      // If we can't read the response body, log that
      console.log(chalk.yellow("Response Body:") + " (unable to read)");
    }

    console.log(chalk.cyan("=".repeat(80)) + "\n");
  }
}
