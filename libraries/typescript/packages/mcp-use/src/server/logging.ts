import chalk from "chalk";
import type { Context, Next } from "hono";

import { getEnv } from "./utils/runtime.js";

/**
 * Server-side debug verbosity for MCP request logging.
 *
 * - `info`: one compact line per request (default)
 * - `debug`: adds `args=<json>` for `tools/call` requests
 * - `trace`: includes full request/response headers and bodies (legacy DEBUG=1)
 */
export type McpDebugLevel = "info" | "debug" | "trace";

/**
 * Resolve the active debug level from environment variables.
 *
 * Precedence: `MCP_DEBUG_LEVEL` (info|debug|trace) > legacy `DEBUG` (any truthy → trace).
 */
export function getDebugLevel(): McpDebugLevel {
  const explicit = getEnv("MCP_DEBUG_LEVEL")?.trim().toLowerCase();
  if (explicit === "info" || explicit === "debug" || explicit === "trace") {
    return explicit;
  }

  // Backward compatibility: DEBUG=1 (or any non-falsy value) maps to `trace`.
  const debugEnv = getEnv("DEBUG");
  const debugEnabled =
    debugEnv !== undefined &&
    debugEnv !== "" &&
    debugEnv !== "0" &&
    debugEnv.toLowerCase() !== "false";
  return debugEnabled ? "trace" : "info";
}

/**
 * Format an object for logging (pretty-print JSON, truncating long strings).
 */
function formatForLogging(obj: any): string {
  function truncate(val: any): any {
    if (typeof val === "string" && val.length > 100) {
      return val.slice(0, 100) + "...";
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
 * Compact JSON.stringify for inline `args=` output. Falls back to `String(v)`
 * if the value is not serializable.
 */
function inlineJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Short session ID used in log lines (matches example format `92c4e0b`).
 */
function shortSessionId(sid: string | null | undefined): string | null {
  if (!sid) return null;
  return sid.replace(/-/g, "").slice(0, 7);
}

/**
 * Try to extract a JSON-RPC error from the response body. Returns the first
 * error message found, or `null` if none.
 *
 * Recognized errors:
 *  - JSON-RPC error envelope: `{ error: { message } }`
 *  - Tool call errors:        `{ result: { isError: true, content: [{ text }] } }`
 *
 * Handles both `application/json` and `text/event-stream` (SSE) payloads,
 * and JSON-RPC batches (arrays of messages).
 */
async function extractResponseError(res: Response): Promise<string | null> {
  if (!res.body) return null;

  let text: string;
  try {
    text = await res.clone().text();
  } catch {
    return null;
  }
  if (!text) return null;

  // Collect candidate JSON payloads. SSE responses are framed as
  // `event: message\ndata: <json>\n\n` — extract each `data:` line.
  const isSse = (res.headers.get("content-type") || "").includes(
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

  for (const payload of payloads) {
    for (const msg of Array.isArray(payload) ? payload : [payload]) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as any;
      if (typeof m.error?.message === "string") return m.error.message;
      if (m.result?.isError === true) {
        const textBlock = Array.isArray(m.result.content)
          ? m.result.content.find(
              (b: any) => b?.type === "text" && typeof b.text === "string"
            )
          : null;
        return textBlock ? String(textBlock.text) : "tool error";
      }
    }
  }
  return null;
}

/**
 * Middleware that logs incoming HTTP requests in a compact format controlled
 * by `MCP_DEBUG_LEVEL` (or legacy `DEBUG`). See {@link getDebugLevel}.
 *
 * Skips logging for inspector telemetry/RPC endpoints, dev widget assets, and
 * polling GETs against `/mcp` and `/inspector/api/*`.
 */
export async function requestLogger(c: Context, next: Next): Promise<void> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString().substring(11, 23);
  const method = c.req.method;
  const url = c.req.url;
  const level = getDebugLevel();

  const pathname = new URL(url).pathname;
  const noisyPaths = [
    "/inspector/api/tel/",
    "/inspector/api/rpc/stream",
    "/inspector/api/rpc/log",
    "/inspector",
    "/mcp-use/widgets/",
    "/mcp-use/public/",
  ];
  const isNoisyGet =
    method === "GET" &&
    (pathname === "/mcp" ||
      pathname.startsWith("/inspector/api/") ||
      pathname.startsWith("/mcp-use/"));

  if (
    noisyPaths.some((noisyPath) => pathname.startsWith(noisyPath)) ||
    isNoisyGet
  ) {
    await next();
    return;
  }

  // Capture request body up front so we can extract MCP method/params.
  let requestBody: any = null;
  let requestHeaders: Record<string, string> = {};

  if (level === "trace") {
    const allHeaders = c.req.header();
    if (allHeaders) requestHeaders = allHeaders;
  }

  if (method !== "GET" && method !== "HEAD") {
    try {
      const clonedRequest = c.req.raw.clone();
      requestBody = await clonedRequest.json().catch(() => {
        return clonedRequest.text().catch(() => null);
      });
    } catch {
      // ignore — body is optional for the log line
    }
  }

  await next();

  const durationMs = Date.now() - startedAt;
  const statusCode = c.res.status;

  // Session ID: incoming header for established sessions, response header for
  // initialize requests (the SDK transport stamps it on the response).
  const incomingSid = c.req.header("mcp-session-id");
  const responseSid = c.res.headers.get("mcp-session-id");
  const mcpMethod: string | undefined = requestBody?.method;
  const isInitialize = mcpMethod === "initialize";

  // Build the line. Colors mirror typical access-log palettes: timestamps,
  // session ids, args and durations are dimmed; method/path/MCP-method are
  // bold; outcome is green (OK) or red (ERROR).
  const parts: string[] = [chalk.gray(`[${timestamp}]`)];

  const sessPrefix = !isInitialize ? shortSessionId(incomingSid) : null;
  if (sessPrefix) parts.push(chalk.gray(`sess=${sessPrefix}`));

  parts.push(method);
  parts.push(chalk.bold(pathname));

  if (mcpMethod) {
    if (isInitialize) {
      const ci = requestBody?.params?.clientInfo;
      const label =
        ci?.name && ci?.version
          ? `: ${ci.name}/${ci.version}`
          : ci?.name
            ? `: ${ci.name}`
            : "";
      parts.push(chalk.bold(`[initialize${label}]`));
    } else if (mcpMethod === "tools/call") {
      const toolName = requestBody?.params?.name ?? "?";
      let segment = chalk.bold(`[tools/call: ${toolName}]`);
      if (level !== "info") {
        const args = requestBody?.params?.arguments;
        if (args !== undefined) {
          segment += ` args=${inlineJson(args)}`;
        }
      }
      parts.push(segment);
    } else {
      parts.push(chalk.bold(`[${mcpMethod}]`));
    }
  }

  if (isInitialize && responseSid) {
    parts.push(chalk.gray(`→ session=${shortSessionId(responseSid)}`));
  }

  // Outcome:
  //  - MCP requests: OK / ERROR <message> based on JSON-RPC error parsing.
  //  - Plain HTTP (HEAD, etc.): the raw status code, colored by class.
  let outcomePart: string;
  const errMsg = await extractResponseError(c.res);
  if (errMsg) {
    outcomePart = chalk.red(`ERROR ${errMsg}`);
  } else if (mcpMethod) {
    outcomePart =
      statusCode >= 400
        ? chalk.red(`ERROR (HTTP ${statusCode})`)
        : chalk.green("OK");
  } else {
    outcomePart =
      statusCode >= 500
        ? chalk.magenta(String(statusCode))
        : statusCode >= 400
          ? chalk.red(String(statusCode))
          : statusCode >= 300
            ? chalk.yellow(String(statusCode))
            : chalk.green(String(statusCode));
  }
  parts.push(outcomePart);
  parts.push(chalk.gray(`(${durationMs}ms)`));

  console.log(parts.join(" "));

  // Trace mode preserves the legacy DEBUG=1 behavior: detailed request and
  // response dumps follow the summary line.
  if (level !== "trace") return;

  console.log("\n" + chalk.cyan("=".repeat(80)));
  console.log(chalk.bold.cyan("[TRACE] Request Details"));
  console.log(chalk.cyan("-".repeat(80)));

  if (Object.keys(requestHeaders).length > 0) {
    console.log(chalk.yellow("Request Headers:"));
    console.log(formatForLogging(requestHeaders));
  }

  if (requestBody !== null) {
    console.log(chalk.yellow("Request Body:"));
    if (typeof requestBody === "string") {
      console.log(requestBody);
    } else {
      console.log(formatForLogging(requestBody));
    }
  }

  const responseHeaders: Record<string, string> = {};
  c.res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  if (Object.keys(responseHeaders).length > 0) {
    console.log(chalk.yellow("Response Headers:"));
    console.log(formatForLogging(responseHeaders));
  }

  try {
    if (c.res.body !== null && c.res.body !== undefined) {
      try {
        const clonedResponse = c.res.clone();
        const responseBody = await clonedResponse.text().catch(() => null);

        if (responseBody !== null && responseBody.length > 0) {
          console.log(chalk.yellow("Response Body:"));
          try {
            const jsonBody = JSON.parse(responseBody);
            console.log(formatForLogging(jsonBody));
          } catch {
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
      } catch {
        console.log(chalk.yellow("Response Body:") + " (unable to clone/read)");
      }
    } else {
      console.log(chalk.yellow("Response Body:") + " (no body)");
    }
  } catch {
    console.log(chalk.yellow("Response Body:") + " (unable to read)");
  }

  console.log(chalk.cyan("=".repeat(80)) + "\n");
}
