import chalk from "chalk";
import { Command } from "commander";
import { MCPClient } from "mcp-use/client";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { formatError, formatInfo } from "../utils/format.js";

interface ScreenshotOptions {
  tool?: string;
  args?: string;
  width: string;
  height: string;
  server?: string;
  theme: "light" | "dark";
  output?: string;
  header?: string[];
  auth?: string;
  waitFor?: string;
  install?: boolean;
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
async function waitForHealth(
  url: string,
  maxAttempts = 60
): Promise<boolean> {
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
 * Resolve a usable dev-server URL: probe `--server` if given, else probe localhost:3000,
 * else spawn `mcp-use dev` on a free port and wait for readiness.
 */
async function ensureDevServer(
  options: ScreenshotOptions,
  cliBin: string
): Promise<DevServerHandle> {
  if (options.server) {
    const ok = await probeServer(options.server);
    if (!ok) {
      throw new Error(
        `Dev server at ${options.server} did not respond on /inspector/health`
      );
    }
    return { url: options.server };
  }

  const localUrl = "http://localhost:3000";
  if (await probeServer(localUrl)) {
    return { url: localUrl };
  }

  const port = await getFreePort();
  const url = `http://localhost:${port}`;
  if (!options.quiet) {
    console.error(
      formatInfo(`Starting dev server on port ${port} (no running server detected)…`)
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
 * Stable 6-char hash of the rendering inputs that affect the pixels.
 */
export function hashInputs(props: ResolvedProps, theme: string): string {
  const stable = JSON.stringify({
    toolInput: props.toolInput ?? null,
    toolOutput: props.toolOutput ?? null,
    theme,
  });
  return createHash("sha256").update(stable).digest("hex").slice(0, 6);
}

export function encodePropsParam(props: ResolvedProps): string {
  return Buffer.from(JSON.stringify(props), "utf8").toString("base64");
}

// Loose Playwright surface — typed at call sites only. The package is an
// optional peer dep, so we deliberately avoid `import type` from "playwright"
// which would fail to resolve in environments without it installed.
type PlaywrightModule = {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<{
      newContext(options?: Record<string, unknown>): Promise<{
        newPage(): Promise<{
          goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
          waitForSelector(
            selector: string,
            options?: Record<string, unknown>
          ): Promise<unknown>;
          screenshot(options: Record<string, unknown>): Promise<unknown>;
        }>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    // @ts-ignore — optional peer dep, resolved at runtime
    return (await import("playwright")) as PlaywrightModule;
  } catch {
    return null;
  }
}

async function runInstall(): Promise<number> {
  const npmInstall = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "playwright"],
    { stdio: "inherit", shell: process.platform === "win32" }
  );
  const code1 = await new Promise<number>((res) =>
    npmInstall.on("exit", (c) => res(c ?? 1))
  );
  if (code1 !== 0) return code1;

  const browsers = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["playwright", "install", "chromium"],
    { stdio: "inherit", shell: process.platform === "win32" }
  );
  return new Promise<number>((res) =>
    browsers.on("exit", (c) => res(c ?? 1))
  );
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
    const uiMeta = (meta?.ui as { resourceUri?: string } | undefined) ?? undefined;
    const resourceUri =
      uiMeta?.resourceUri ?? (meta?.["openai/outputTemplate"] as string | undefined);
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
  if (options.install) {
    const code = await runInstall();
    process.exit(code);
  }

  if (!options.tool) {
    console.error(
      formatError("--tool <name> is required (optionally with --args).")
    );
    process.exit(1);
  }

  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error(
      formatError(
        "Playwright not found. Run `mcp-use screenshot --install` to install it (and the Chromium browser binary), or `npm install playwright && npx playwright install chromium` manually."
      )
    );
    process.exit(1);
  }

  const width = parseDimension(options.width, "width");
  const height = parseDimension(options.height, "height");
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
    const mcpUrl = `${dev.url}/mcp`;
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

    const hash = hashInputs(resolved, options.theme);
    const outPath = path.resolve(
      options.output ?? `./${viewName}-${hash}.png`
    );
    await mkdir(path.dirname(outPath), { recursive: true });

    const browser = await playwright.chromium.launch();
    try {
      const ctx = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        colorScheme: options.theme,
      });
      const page = await ctx.newPage();
      const navTimeout = parseInt(options.timeout, 10) || 30000;
      await page.goto(previewUrl.toString(), {
        waitUntil: "load",
        timeout: navTimeout,
      });
      const waitSelector = options.waitFor ?? 'body[data-view-ready="true"]';
      await page.waitForSelector(waitSelector, { timeout: navTimeout });
      await page.screenshot({
        path: outPath,
        type: "png",
        fullPage: false,
        clip: { x: 0, y: 0, width, height },
      });
    } finally {
      await browser.close();
    }

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
    .option(
      "--args <json>",
      "JSON-encoded arguments for the tool call."
    )
    .option("--width <px>", "Browser viewport width in pixels.", "800")
    .option("--height <px>", "Browser viewport height in pixels.", "600")
    .option(
      "--server <url>",
      "MCP server URL. When omitted, probes localhost:3000 then auto-spawns `mcp-use dev`."
    )
    .option(
      "--theme <light|dark>",
      "Color scheme to render the view in.",
      "light"
    )
    .option(
      "--output <path>",
      "Output PNG path. Defaults to ./<view>-<hash>.png in cwd."
    )
    .option(
      "--header <K:V...>",
      "HTTP header forwarded to the MCP server. Repeatable.",
      (val: string, prev: string[] = []) => [...prev, val]
    )
    .option(
      "--auth <token>",
      "Bearer token forwarded as Authorization header."
    )
    .option(
      "--wait-for <selector>",
      'Override readiness selector (default: body[data-view-ready="true"]).'
    )
    .option(
      "--timeout <ms>",
      "Navigation + readiness timeout in ms.",
      "30000"
    )
    .option("--quiet", "Suppress dev-server output.")
    .option(
      "--install",
      "Install Playwright + the Chromium browser binary, then exit."
    )
    .action(async (opts: ScreenshotOptions) => {
      await screenshotCommand(opts, cliBin);
    });
}
