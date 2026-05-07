import chalk from "chalk";
import { Command } from "commander";
import { MCPClient } from "mcp-use/client";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { captureScreenshot } from "../utils/cdp-screenshot.js";
import { resolveChromePath } from "../utils/chrome-path.js";
import { formatError, formatInfo } from "../utils/format.js";

interface ScreenshotOptions {
  tool?: string;
  args?: string;
  width: string;
  height: string;
  inspector?: string;
  mcp?: string;
  theme: "light" | "dark";
  output?: string;
  header?: string[];
  auth?: string;
  waitFor?: string;
  delay?: string;
  quiet?: boolean;
  timeout: string;
}

interface ResolvedProps {
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
}

/**
 * Allocate a free TCP port by binding to 0 and reading back what the OS chose.
 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Failed to allocate free port")));
      }
    });
  });
}

/**
 * Probe a server's `/inspector/health` endpoint. Returns true if it responds 200 within the timeout.
 */
async function probeServer(url: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const u = new URL("/inspector/health", url);
    const res = await fetch(u, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Wait until `/inspector/health` reports ready, polling every second.
 */
async function waitForHealth(url: string, maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await probeServer(url)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

interface DevServerHandle {
  url: string;
  child?: ChildProcess;
}

/**
 * Resolve a usable inspector host: probe `--inspector` if given, else probe localhost:3000,
 * else spawn `mcp-use dev` on a free port and wait for readiness. The inspector host
 * is where the `/inspector/preview/:view` SPA route renders the captured view.
 */
async function ensureDevServer(
  options: ScreenshotOptions,
  cliBin: string
): Promise<DevServerHandle> {
  if (options.inspector) {
    const ok = await probeServer(options.inspector);
    if (!ok) {
      throw new Error(
        `Inspector at ${options.inspector} did not respond on /inspector/health`
      );
    }
    return { url: options.inspector };
  }

  const localUrl = "http://localhost:3000";
  if (await probeServer(localUrl)) {
    return { url: localUrl };
  }

  const port = await getFreePort();
  const url = `http://localhost:${port}`;
  if (!options.quiet) {
    console.error(
      formatInfo(
        `Starting dev server on port ${port} (no running server detected)…`
      )
    );
  }

  const child = spawn(
    process.execPath,
    [cliBin, "dev", "--no-open", "--no-hmr", "--port", String(port)],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MCP_USE_CLI_DEV: "1" },
    }
  );

  const prefix = chalk.gray("[dev]");
  if (!options.quiet) {
    child.stdout?.on("data", (d: Buffer) => {
      process.stderr.write(`${prefix} ${d}`);
    });
    child.stderr?.on("data", (d: Buffer) => {
      process.stderr.write(`${prefix} ${d}`);
    });
  } else {
    child.stdout?.resume();
    child.stderr?.resume();
  }

  const ready = await waitForHealth(url);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(
      `Dev server failed to come up on ${url} within 60s. Check that you're in a project with an MCP server entry.`
    );
  }
  return { url, child };
}

function killChild(child: ChildProcess | undefined) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // Ignore.
  }
}

export function parseHeaders(
  headers: string[] | undefined,
  auth: string | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (auth) out["Authorization"] = `Bearer ${auth}`;
  for (const h of headers ?? []) {
    const idx = h.indexOf(":");
    if (idx === -1) {
      throw new Error(`Invalid --header value: "${h}". Expected "Key: Value".`);
    }
    const k = h.slice(0, idx).trim();
    const v = h.slice(idx + 1).trim();
    if (!k) {
      throw new Error(`Invalid --header value: "${h}". Empty key.`);
    }
    out[k] = v;
  }
  return out;
}

/**
 * Returns a filesystem-safe timestamp string: YYYY-MM-DD_HH-mm-ss
 */
export function timestampSuffix(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${datePart}_${timePart}`;
}

export function encodePropsParam(props: ResolvedProps): string {
  return Buffer.from(JSON.stringify(props), "utf8").toString("base64");
}

interface ResolvedToolCall {
  view: string;
  toolInput: Record<string, unknown>;
  toolOutput: unknown;
}

/**
 * Connect to the MCP server, call the tool, and extract the view URI + structured output.
 *
 * The view "name" returned is derived from the tool's metadata (`_meta.ui.resourceUri`
 * or `openai/outputTemplate`) — both follow the `ui://widget/<name>[.<buildId>].html`
 * convention. The preview route does its own resource lookup by name, so we only
 * need the bare view name here.
 */
async function callToolAndResolve(
  serverUrl: string,
  headers: Record<string, string>,
  toolName: string,
  argsJson: string | undefined
): Promise<ResolvedToolCall> {
  const args: Record<string, unknown> = argsJson ? JSON.parse(argsJson) : {};

  const client = new MCPClient();
  client.addServer("screenshot", { url: serverUrl, headers });
  const session = await client.createSession("screenshot");
  try {
    const tool = session.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(
        `Tool "${toolName}" not found on ${serverUrl}. Available: ${session.tools
          .map((t) => t.name)
          .join(", ")}`
      );
    }
    const meta = (tool as { _meta?: Record<string, unknown> })._meta;
    const uiMeta =
      (meta?.ui as { resourceUri?: string } | undefined) ?? undefined;
    const resourceUri =
      uiMeta?.resourceUri ??
      (meta?.["openai/outputTemplate"] as string | undefined);
    if (!resourceUri) {
      throw new Error(
        `Tool "${toolName}" does not declare a UI resource (expected _meta.ui.resourceUri or openai/outputTemplate).`
      );
    }
    const view = extractViewName(resourceUri);

    const result = await session.callTool(toolName, args);
    return { view, toolInput: args, toolOutput: result };
  } finally {
    await client.closeAllSessions().catch(() => {});
  }
}

export function extractViewName(resourceUri: string): string {
  const m = resourceUri.match(/^ui:\/\/widget\/(.+)$/);
  if (!m) return resourceUri;
  // Strip trailing .html and any .<buildId> segment before it.
  return m[1].replace(/\.html$/, "").replace(/\.[0-9a-f]+$/i, "");
}

export function parseDimension(raw: string, name: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer (got "${raw}")`);
  }
  return n;
}

export async function screenshotCommand(
  options: ScreenshotOptions,
  cliBin: string
): Promise<void> {
  if (!options.tool) {
    console.error(
      formatError("--tool <name> is required (optionally with --args).")
    );
    process.exit(1);
  }

  let chromePath: string;
  try {
    chromePath = resolveChromePath();
  } catch (err) {
    console.error(
      formatError(err instanceof Error ? err.message : String(err))
    );
    process.exit(1);
  }

  const width = parseDimension(options.width, "width");
  const height = parseDimension(options.height, "height");
  const navTimeout = parseInt(options.timeout, 10) || 30000;
  const headers = parseHeaders(options.header, options.auth);

  const dev = await ensureDevServer(options, cliBin);
  const handleSignal = (sig: NodeJS.Signals) => () => {
    killChild(dev.child);
    process.exit(sig === "SIGTERM" ? 143 : 130);
  };
  process.on("SIGINT", handleSignal("SIGINT"));
  process.on("SIGTERM", handleSignal("SIGTERM"));

  let resolved: ResolvedProps;
  let viewName: string;

  try {
    const mcpUrl = options.mcp ?? `${dev.url}/mcp`;
    const tc = await callToolAndResolve(
      mcpUrl,
      headers,
      options.tool as string,
      options.args
    );
    viewName = tc.view;
    resolved = { toolInput: tc.toolInput, toolOutput: tc.toolOutput };

    const previewUrl = new URL(`/inspector/preview/${viewName}`, dev.url);
    previewUrl.searchParams.set("props", encodePropsParam(resolved));
    previewUrl.searchParams.set("theme", options.theme);
    previewUrl.searchParams.set("server", mcpUrl);
    if (Object.keys(headers).length > 0) {
      previewUrl.searchParams.set(
        "headers",
        Buffer.from(JSON.stringify(headers), "utf8").toString("base64")
      );
    }

    const ts = timestampSuffix();
    const outPath = path.resolve(options.output ?? `./${viewName}-${ts}.png`);
    await mkdir(path.dirname(outPath), { recursive: true });

    const delayMs = options.delay ? parseInt(options.delay, 10) : 0;
    await captureScreenshot({
      url: previewUrl.toString(),
      width,
      height,
      theme: options.theme,
      waitForSelector: options.waitFor ?? 'body[data-view-ready="true"]',
      timeoutMs: navTimeout,
      outputPath: outPath,
      chromePath,
      delayMs: Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0,
    });

    console.log(`Saved screenshot: ${outPath} (${width}×${height})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(formatError(`Screenshot failed: ${msg}`));
    process.exitCode = 1;
  } finally {
    killChild(dev.child);
  }
}

export function createScreenshotCommand(cliBin: string): Command {
  return new Command("screenshot")
    .description(
      "Render an MCP Apps view headlessly and save a PNG by calling a tool and rendering its UI resource with the result."
    )
    .option(
      "--tool <name>",
      "Tool to call. Its UI resource is rendered with the result."
    )
    .option("--args <json>", "JSON-encoded arguments for the tool call.")
    .option("--width <px>", "Browser viewport width in pixels.", "800")
    .option("--height <px>", "Browser viewport height in pixels.", "600")
    .option(
      "--inspector <url>",
      "Inspector host that serves /inspector/preview/:view. When omitted, probes localhost:3000 then auto-spawns `mcp-use dev`."
    )
    .option(
      "--mcp <url>",
      "MCP server URL to call the tool against. Defaults to `<inspector>/mcp`. Use this to render a remote MCP's view inside a local inspector."
    )
    .option(
      "--theme <light|dark>",
      "Color scheme to render the view in.",
      "light"
    )
    .option(
      "--output <path>",
      "Output PNG path. Defaults to ./<view>-<timestamp>.png in cwd."
    )
    .option(
      "--header <K:V...>",
      "HTTP header forwarded to the MCP server. Repeatable.",
      (val: string, prev: string[] = []) => [...prev, val]
    )
    .option("--auth <token>", "Bearer token forwarded as Authorization header.")
    .option(
      "--wait-for <selector>",
      'Override readiness selector (default: body[data-view-ready="true"]).'
    )
    .option(
      "--delay <ms>",
      "Extra wait after readiness, to let chart animations / async layouts settle.",
      "0"
    )
    .option("--timeout <ms>", "Navigation + readiness timeout in ms.", "30000")
    .option("--quiet", "Suppress dev-server output.")
    .action(async (opts: ScreenshotOptions) => {
      await screenshotCommand(opts, cliBin);
    });
}
