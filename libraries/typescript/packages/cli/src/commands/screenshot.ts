import chalk from "chalk";
import { Command } from "commander";
import type { MCPSession } from "mcp-use/client";
import { MCPClient } from "mcp-use/client";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { captureScreenshot } from "../utils/cdp-screenshot.js";
import { resolveChromePath } from "../utils/chrome-path.js";
import { formatError, formatInfo, formatSchema } from "../utils/format.js";
import { parseToolArgs } from "../utils/parse-args.js";
import {
  activeSessions,
  cleanupAndExit,
  getCliClientInfo,
  getOrRestoreSession,
} from "../utils/session.js";

interface ScreenshotOptions {
  tool?: string;
  width: string;
  height: string;
  inspector?: string;
  mcp?: string;
  session?: string;
  theme: "light" | "dark";
  output?: string;
  waitFor?: string;
  delay?: string;
  quiet?: boolean;
  timeout: string;
  cdpUrl?: string;
}

interface ScreenshotBundle {
  resourceUri: string;
  resourceContents: unknown;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
}

/**
 * Inspect a tool's `_meta` for the UI resource URI it renders, if any. Falls back
 * to the OpenAI Apps `openai/outputTemplate` key for cross-ecosystem compatibility.
 */
export function detectToolResourceUri(
  tool: { _meta?: Record<string, unknown> } | undefined | null
): string | null {
  if (!tool) return null;
  const meta = tool._meta;
  if (!meta) return null;
  const uiMeta = (meta.ui as { resourceUri?: string } | undefined) ?? undefined;
  return (
    uiMeta?.resourceUri ??
    (meta["openai/outputTemplate"] as string | undefined) ??
    null
  );
}

export interface CaptureToolScreenshotInputs {
  session: MCPSession;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolOutput: unknown;
  resourceUri: string;
}

export interface CaptureToolScreenshotOptions {
  width?: number;
  height?: number;
  theme?: "light" | "dark";
  output?: string;
  waitFor?: string;
  delayMs?: number;
  timeoutMs?: number;
  inspector?: string;
  quiet?: boolean;
  /**
   * Pre-existing CDP WebSocket URL. When set, the screenshot is captured via
   * the remote browser instead of spawning a local Chrome. The inspector URL
   * must be reachable from that remote browser.
   */
  cdpUrl?: string;
}

export interface CaptureToolScreenshotResult {
  outputPath: string;
  width: number;
  height: number;
  view: string;
}

/**
 * End-to-end screenshot pipeline for a tool whose UI resource has already been
 * resolved. Reuses the caller's existing tool result so we don't re-invoke the
 * tool, ensures a dev server is running (spawning one if needed), reads the UI
 * resource, and captures via CDP. Cleans up any spawned dev server before
 * returning, even on failure.
 */
export async function captureToolScreenshot(
  inputs: CaptureToolScreenshotInputs,
  options: CaptureToolScreenshotOptions = {}
): Promise<CaptureToolScreenshotResult> {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const theme: "light" | "dark" = options.theme ?? "light";
  const timeoutMs = options.timeoutMs ?? 30000;
  const delayMs = options.delayMs ?? 0;

  const chromePath = options.cdpUrl ? undefined : resolveChromePath();
  const view = extractViewName(inputs.resourceUri);

  const devOptions: ScreenshotOptions = {
    width: String(width),
    height: String(height),
    theme,
    timeout: String(timeoutMs),
    inspector: options.inspector,
    quiet: options.quiet,
  };

  let devHandle: DevServerHandle | undefined;
  try {
    devHandle = await ensureDevServer(devOptions);

    const resourceContents = await inputs.session.readResource(
      inputs.resourceUri
    );
    const bundle: ScreenshotBundle = {
      resourceUri: inputs.resourceUri,
      resourceContents,
      toolInput: inputs.toolArgs,
      toolOutput: inputs.toolOutput,
    };

    const previewUrl = new URL(`/inspector/preview/${view}`, devHandle.url);
    previewUrl.searchParams.set("theme", theme);

    const ts = timestampSuffix();
    const outputPath = path.resolve(options.output ?? `./${view}-${ts}.png`);
    await mkdir(path.dirname(outputPath), { recursive: true });

    await captureScreenshot({
      url: previewUrl.toString(),
      width,
      height,
      theme,
      waitForSelector: options.waitFor ?? 'body[data-view-ready="true"]',
      timeoutMs,
      outputPath,
      chromePath,
      cdpUrl: options.cdpUrl,
      delayMs: Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0,
      bundle,
    });

    return { outputPath, width, height, view };
  } finally {
    killChild(devHandle?.child);
  }
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
 * Probe a server's `/inspector/health` endpoint. Returns true only if it
 * responds with the inspector's JSON payload (`{ status: "ok" }`).
 *
 * A bare `res.ok` check is not enough: a Vite/SPA dev server happily returns
 * 200 + HTML for any unknown path (SPA fallback), which would be misidentified
 * as a valid inspector and later cause a silent timeout when the preview
 * route is missing.
 */
async function probeServer(url: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const u = new URL("/inspector/health", url);
    const res = await fetch(u, { signal: controller.signal });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return false;
    const body = (await res.json()) as { status?: string };
    return body?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Wait until `/inspector/health` reports ready, polling every 200ms.
 */
async function waitForHealth(url: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeServer(url)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

interface DevServerHandle {
  url: string;
  child?: ChildProcess;
}

/**
 * Resolve the path to `@mcp-use/inspector`'s standalone CLI entry. Throws
 * with a clear message when the inspector package can't be located — that
 * usually means the workspace hasn't been installed/built.
 *
 * We can't use `require.resolve('@mcp-use/inspector')` because the inspector
 * package's `exports` field only declares an `import` condition, so CJS
 * resolution fails. Subpath resolution (`/dist/cli.js`, `/package.json`)
 * also fails because neither is listed in `exports`. So we walk up from
 * both the current module and the CWD looking for the installed package.
 */
function resolveInspectorCli(): string {
  const candidateRoots = new Set<string>();
  // CJS: __dirname is defined; ESM: derive from import.meta.url.
  const moduleDir =
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(new URL(import.meta.url).pathname);
  candidateRoots.add(moduleDir);
  candidateRoots.add(process.cwd());

  for (const start of candidateRoots) {
    let dir = start;
    while (true) {
      const candidate = path.join(
        dir,
        "node_modules",
        "@mcp-use",
        "inspector",
        "dist",
        "cli.js"
      );
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    "Could not locate `@mcp-use/inspector` in node_modules. Install the inspector package or pass --inspector <url> to use an existing instance."
  );
}

/**
 * Resolve a usable inspector host:
 *
 *   - When `--inspector <url>` is given, probe it (strict: must return the
 *     inspector's JSON health payload) and use it.
 *   - Otherwise, always spawn a fresh `@mcp-use/inspector` on a free port.
 *
 * Note: we no longer try to reuse a server on `localhost:3000`. A Vite-only
 * dev server (or any unrelated 200-returning service) would otherwise be
 * misidentified and cause silent rendering failures. Always-spawn keeps
 * behavior predictable and decoupled from whatever else is running locally.
 */
async function ensureDevServer(
  options: ScreenshotOptions
): Promise<DevServerHandle> {
  if (options.inspector) {
    const ok = await probeServer(options.inspector);
    if (!ok) {
      throw new Error(
        `Inspector at ${options.inspector} did not respond on /inspector/health with status:"ok"`
      );
    }
    return { url: options.inspector };
  }

  const port = await getFreePort();
  const url = `http://localhost:${port}`;
  if (!options.quiet) {
    console.error(formatInfo(`Starting inspector on port ${port}…`));
  }

  const inspectorCli = resolveInspectorCli();
  const child = spawn(
    process.execPath,
    [inspectorCli, "--port", String(port), "--no-open"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MCP_INSPECTOR_MODE: "standalone" },
    }
  );

  const prefix = chalk.gray("[inspector]");
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
    throw new Error(`Inspector failed to come up on ${url} within 15s.`);
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

/**
 * Returns a filesystem-safe timestamp string: YYYY-MM-DD_HH-mm-ss
 */
export function timestampSuffix(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${datePart}_${timePart}`;
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

const AD_HOC_SESSION_NAME = "__screenshot_ad_hoc__";

/**
 * Resolve an authenticated MCPSession for the screenshot run.
 *
 * Resolution order:
 *  1. `--session <name>` → restore that named session (errors if not found)
 *  2. `--mcp <url>` → open an unauthenticated ad-hoc session at that URL
 *  3. otherwise → restore the active saved session (errors if none)
 */
async function resolveSessionForScreenshot(
  options: ScreenshotOptions
): Promise<MCPSession | null> {
  if (options.session) {
    const result = await getOrRestoreSession(options.session);
    return result?.session ?? null;
  }

  if (options.mcp) {
    const client = new MCPClient();
    client.addServer(AD_HOC_SESSION_NAME, {
      url: options.mcp,
      clientInfo: getCliClientInfo(),
    });
    try {
      const session = await client.createSession(AD_HOC_SESSION_NAME);
      activeSessions.set(AD_HOC_SESSION_NAME, { client, session });
      return session;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(formatError(`Failed to connect to ${options.mcp}: ${msg}`));
      return null;
    }
  }

  const result = await getOrRestoreSession(null);
  return result?.session ?? null;
}

export async function screenshotCommand(
  options: ScreenshotOptions,
  argsList: string[] | undefined
): Promise<void> {
  let exitCode = 0;

  try {
    if (!options.tool) {
      console.error(
        formatError(
          "--tool <name> is required (optionally with key=value args)."
        )
      );
      exitCode = 1;
      return;
    }

    try {
      resolveChromePath();
    } catch (err) {
      console.error(
        formatError(err instanceof Error ? err.message : String(err))
      );
      exitCode = 1;
      return;
    }

    const width = parseDimension(options.width, "width");
    const height = parseDimension(options.height, "height");
    const navTimeout = parseInt(options.timeout, 10) || 30000;
    const delayMs = options.delay ? parseInt(options.delay, 10) : 0;

    // Resolve session before spawning the dev server so auth issues fail fast.
    const session = await resolveSessionForScreenshot(options);
    if (!session) {
      exitCode = 1;
      return;
    }

    const tool = session.tools.find((t) => t.name === options.tool);
    if (!tool) {
      throw new Error(
        `Tool "${options.tool}" not found. Available: ${session.tools
          .map((t) => t.name)
          .join(", ")}`
      );
    }
    const resourceUri = detectToolResourceUri(tool);
    if (!resourceUri) {
      throw new Error(
        `Tool "${options.tool}" does not declare a UI resource (expected _meta.ui.resourceUri or openai/outputTemplate).`
      );
    }

    let toolArgs: Record<string, unknown> = {};
    if (argsList && argsList.length > 0) {
      try {
        toolArgs = parseToolArgs(
          argsList,
          tool.inputSchema as Parameters<typeof parseToolArgs>[1]
        );
      } catch (err) {
        console.error(
          formatError(err instanceof Error ? err.message : String(err))
        );
        console.log("");
        console.log(formatInfo("Usage:"));
        console.log(
          `  npx mcp-use screenshot --tool ${options.tool} key=value [key2=value2 ...]`
        );
        console.log(
          `  npx mcp-use screenshot --tool ${options.tool} nested:='{"a":1}'   # JSON value`
        );
        console.log(
          `  npx mcp-use screenshot --tool ${options.tool} '{"key":"value"}'   # full JSON object`
        );
        if (tool.inputSchema) {
          console.log("");
          console.log(formatInfo("Tool schema:"));
          console.log(formatSchema(tool.inputSchema));
        }
        exitCode = 1;
        return;
      }
    }
    const toolOutput = await session.callTool(options.tool, toolArgs);

    const result = await captureToolScreenshot(
      {
        session,
        toolName: options.tool,
        toolArgs,
        toolOutput,
        resourceUri,
      },
      {
        width,
        height,
        theme: options.theme,
        output: options.output,
        waitFor: options.waitFor,
        delayMs,
        timeoutMs: navTimeout,
        inspector: options.inspector,
        quiet: options.quiet,
        cdpUrl: options.cdpUrl,
      }
    );

    console.log(
      `Saved screenshot: ${result.outputPath} (${result.width}×${result.height})`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(formatError(`Screenshot failed: ${msg}`));
    exitCode = 1;
  } finally {
    await cleanupAndExit(exitCode);
  }
}

export function createScreenshotCommand(): Command {
  return new Command("screenshot")
    .description(
      "Render an MCP Apps view headlessly and save a PNG by calling a tool and rendering its UI resource with the result."
    )
    .argument(
      "[args...]",
      "Tool args as key=value pairs (use key:=<json> for nested values, or pass a single JSON object)."
    )
    .option(
      "--tool <name>",
      "Tool to call. Its UI resource is rendered with the result."
    )
    .option("--width <px>", "Browser viewport width in pixels.", "800")
    .option("--height <px>", "Browser viewport height in pixels.", "600")
    .option(
      "--inspector <url>",
      "Inspector host that serves /inspector/preview/:view. When omitted, probes localhost:3000 then auto-spawns `mcp-use dev`."
    )
    .option(
      "--session <name>",
      "Saved session name (from `mcp-use client connect`). Defaults to the active session."
    )
    .option(
      "--mcp <url>",
      "Ad-hoc MCP server URL (escape hatch). Used only when no --session and no active saved session. No authentication."
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
      "--wait-for <selector>",
      'Override readiness selector (default: body[data-view-ready="true"]).'
    )
    .option(
      "--delay <ms>",
      "Extra wait after readiness, to let chart animations / async layouts settle.",
      "0"
    )
    .option("--timeout <ms>", "Navigation + readiness timeout in ms.", "30000")
    .option(
      "--cdp-url <url>",
      "Connect to an existing CDP WebSocket (ws:// or wss://) instead of spawning local Chrome. Useful for hosted browsers like Notte."
    )
    .option("--quiet", "Suppress dev-server output.")
    .action(async (args: string[], opts: ScreenshotOptions) => {
      await screenshotCommand(opts, args);
    });
}
