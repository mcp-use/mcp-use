import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import type { MCPConnection } from "@mcp-use/client";

import {
  openDirectConnection,
  openSavedConnection,
  parseMcpArguments,
} from "./client.js";
import {
  CommandError,
  printResult,
  reportError,
  UsageError,
  wantsJson,
} from "./shared.js";

interface PreviewHealth {
  status: string;
  protocol: string;
  version: number;
  capabilities: string[];
}

interface BrowserHandle {
  cdp: CdpClient;
  sessionId: string;
  close(): Promise<void>;
}

interface LocalInspectorHandle {
  origin: string;
  close(): Promise<void>;
}

const HELP = `Usage: mcp-use screenshot (--server <name> | --mcp <url>) --tool <name> [args...] [options]

Call a view-backed MCP tool and capture its rendered MCP App as PNG.

Source options:
  --server <name>             Use a server saved by mcp-use client
  --mcp <url>                 Connect directly to an HTTP(S) MCP endpoint
  -H, --header <"Key: Value"> Header for --mcp; repeatable and incompatible
                              with --server

Capture options:
  --tool <name>               View-backed tool to call (required)
  --output <path>             Output PNG path (default: timestamped view name)
  --width <px>                Host/widget width (default: 768, matching an
                              OpenAI inline MCP App container)
  --height <px>               Host viewport height used for responsive layout
                              (default: 720); PNG is cropped to widget bounds
  --device-scale-factor <n>   Pixel density, greater than 0 and at most 4
                              (default: 1)
  --theme <light|dark>        Host theme (default: light)
  --wait-for <selector>       Wait for a selector before capture
  --delay <ms>                Additional delay after readiness (default: 0)
  --timeout <ms>              Tool/browser timeout (default: 30000)
  --inspector <url>           Use an existing Inspector origin
  --cdp-url <url>             Use an existing Chrome DevTools endpoint
  --json                      Emit one result or error; never prompt
  -h, --help                  Show this help

Arguments:
  Pass one JSON object or key=value/key:=<json> pairs after the options.

Examples:
  mcp-use screenshot --server demo --tool show-app appName=Demo
  mcp-use screenshot --mcp https://example.com/mcp --tool show-app \\
    '{"appName":"CI"}' --theme dark --output app.png --json

Exit codes:
  0  Capture succeeded or help
  2  Invalid arguments
  1  MCP, tool, Inspector, browser, readiness, or write failure`;

/** Run `mcp-use screenshot`. */
export async function runScreenshot(argv: readonly string[]): Promise<number> {
  if (argv.some((token) => token === "--help" || token === "-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const json = wantsJson(argv);
  let connection: MCPConnection | undefined;
  let browser: BrowserHandle | undefined;
  let localInspector: LocalInspectorHandle | undefined;
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        server: { type: "string" },
        mcp: { type: "string" },
        tool: { type: "string" },
        header: { type: "string", short: "H", multiple: true },
        output: { type: "string" },
        width: { type: "string", default: "768" },
        height: { type: "string", default: "720" },
        "device-scale-factor": { type: "string", default: "1" },
        theme: { type: "string", default: "light" },
        inspector: { type: "string" },
        "cdp-url": { type: "string" },
        "wait-for": { type: "string" },
        delay: { type: "string", default: "0" },
        timeout: { type: "string", default: "30000" },
        json: { type: "boolean" },
      },
    });
    if ((values.server === undefined) === (values.mcp === undefined)) {
      throw new UsageError("Exactly one of --server or --mcp is required.");
    }
    if (values.tool === undefined) throw new UsageError("--tool is required.");
    if (values.server !== undefined && values.header !== undefined) {
      throw new UsageError("--header is valid only with --mcp.");
    }
    if (values.theme !== "light" && values.theme !== "dark") {
      throw new UsageError("--theme must be light or dark.");
    }
    const width = positive(values.width, "--width");
    const height = positive(values.height, "--height");
    const scale = Number(values["device-scale-factor"]);
    if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
      throw new UsageError(
        "--device-scale-factor must be greater than 0 and at most 4."
      );
    }
    const timeout = positive(values.timeout, "--timeout");
    const delay = nonNegative(values.delay, "--delay");
    const headers = parseHeaders(values.header ?? []);
    connection =
      values.server !== undefined
        ? await openSavedConnection(values.server, 300_000, json)
        : await openDirectConnection(new URL(values.mcp!).href, headers, json);

    const tools = await connection.listTools();
    const tool = tools.find((candidate) => candidate.name === values.tool);
    if (tool === undefined)
      throw new CommandError(
        "tool_not_found",
        `Tool not found: ${values.tool}`
      );
    const resourceUri = resourceUriFrom(tool);
    const input = parseMcpArguments(positionals);
    const result = await connection.callTool(values.tool, input, { timeout });
    if (result.isError === true) {
      throw new CommandError(
        "tool_failed",
        `Tool ${values.tool} returned an error.`,
        result
      );
    }
    const resource = await connection.readResource(resourceUri);
    resourceText(resource);

    localInspector =
      values.inspector === undefined
        ? await launchLocalInspector(timeout)
        : undefined;
    const inspector = (values.inspector ?? localInspector!.origin).replace(
      /\/+$/,
      ""
    );
    await verifyPreview(inspector, timeout);
    const viewName = viewNameFrom(resourceUri);
    const previewUrl = new URL(
      `${inspector}/inspector/preview/${encodeURIComponent(viewName)}`
    );
    previewUrl.searchParams.set("protocol", "1");
    previewUrl.searchParams.set("theme", values.theme);
    previewUrl.searchParams.set("width", String(width));

    browser =
      values["cdp-url"] !== undefined
        ? await connectRemoteBrowser(values["cdp-url"])
        : await launchLocalBrowser();
    await browser.cdp.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
      },
      browser.sessionId
    );
    await browser.cdp.send("Page.enable", {}, browser.sessionId);
    await browser.cdp.send("Runtime.enable", {}, browser.sessionId);
    await browser.cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `globalThis.__mcpUsePreviewBundle = ${serializeInline({
          resourceUri,
          resourceContents: resource,
          toolInput: input,
          toolOutput: result,
        })};`,
      },
      browser.sessionId
    );
    await browser.cdp.send(
      "Page.navigate",
      { url: previewUrl.href },
      browser.sessionId
    );
    await waitForDocument(browser, timeout);
    await waitForReady(browser, values["wait-for"], timeout);
    if (delay > 0) await sleep(delay);
    const bounds = await readCaptureBounds(browser);
    const captured = (await browser.cdp.send(
      "Page.captureScreenshot",
      {
        format: "png",
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { ...bounds, scale: 1 },
      },
      browser.sessionId
    )) as { data?: unknown };
    if (typeof captured.data !== "string") {
      throw new CommandError(
        "capture_failed",
        "Chrome returned no screenshot data."
      );
    }
    const output = resolve(
      values.output ??
        `${viewName}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`
    );
    await writeFile(output, Buffer.from(captured.data, "base64"));
    printResult(
      {
        path: output,
        width: bounds.width,
        height: bounds.height,
        viewport: { width, height },
        deviceScaleFactor: scale,
        theme: values.theme,
      },
      json,
      output
    );
    return 0;
  } catch (error) {
    return reportError(
      error instanceof TypeError ? new UsageError(error.message) : error,
      json
    );
  } finally {
    await browser?.close().catch(() => {});
    await localInspector?.close().catch(() => {});
    await connection?.disconnect().catch(() => {});
  }
}

async function launchLocalInspector(
  timeout: number
): Promise<LocalInspectorHandle> {
  const port = await freePort();
  const inspectorEntry = import.meta.resolve("@mcp-use/inspector");
  const cliPath = fileURLToPath(new URL("../cli.js", inspectorEntry));
  const child = spawn(
    process.execPath,
    [cliPath, "--port", String(port), "--no-open"],
    { stdio: "ignore" }
  );
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForInspector(origin, child, Math.min(timeout, 10_000));
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return {
    origin,
    async close() {
      await stopChild(child);
    },
  };
}

async function waitForInspector(
  origin: string,
  child: ChildProcess,
  timeout: number
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new CommandError(
        "inspector_start_failed",
        `Packaged Inspector exited before becoming ready (code ${child.exitCode}).`
      );
    }
    try {
      await verifyPreview(origin, Math.min(1_000, timeout));
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new CommandError(
    "inspector_start_failed",
    "Packaged Inspector did not start in time."
  );
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    sleep(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function verifyPreview(origin: string, timeout: number): Promise<void> {
  const response = await fetch(`${origin}/inspector/health`, {
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    throw new CommandError(
      "incompatible_inspector",
      `Inspector health check failed (${response.status}).`
    );
  }
  const health = (await response.json()) as Partial<PreviewHealth>;
  if (
    health.status !== "ok" ||
    health.protocol !== "mcp-use-inspector-preview" ||
    health.version !== 1 ||
    !health.capabilities?.includes("view-preview")
  ) {
    throw new CommandError(
      "incompatible_inspector",
      "Inspector does not support mcp-use-inspector-preview version 1."
    );
  }
}

function resourceUriFrom(tool: unknown): string {
  const meta =
    tool !== null && typeof tool === "object"
      ? (tool as { _meta?: Record<string, unknown> })._meta
      : undefined;
  const nested =
    meta?.["ui"] !== null && typeof meta?.["ui"] === "object"
      ? (meta["ui"] as Record<string, unknown>)["resourceUri"]
      : undefined;
  const uri = nested ?? meta?.["ui/resourceUri"];
  if (typeof uri !== "string") {
    throw new CommandError(
      "missing_view",
      "Tool does not advertise an MCP Apps UI resource."
    );
  }
  return uri;
}

function resourceText(resource: unknown): string {
  const contents =
    resource !== null && typeof resource === "object"
      ? (resource as { contents?: unknown }).contents
      : undefined;
  if (!Array.isArray(contents))
    throw new CommandError("invalid_view", "View resource has no contents.");
  const item = contents.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as { text?: unknown }).text === "string"
  ) as { text: string } | undefined;
  if (item === undefined)
    throw new CommandError(
      "invalid_view",
      "View resource has no HTML document."
    );
  return item.text;
}

function viewNameFrom(uri: string): string {
  const url = new URL(uri);
  return basename(url.pathname).replace(/\.html$/, "") || url.hostname;
}

async function launchLocalBrowser(): Promise<BrowserHandle> {
  const executable = await chromeExecutable();
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "mcp-use-chrome-"));
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  try {
    const version = await pollJson<{ webSocketDebuggerUrl: string }>(
      `http://127.0.0.1:${port}/json/version`,
      10_000
    );
    const connected = await connectBrowser(version.webSocketDebuggerUrl);
    return {
      ...connected,
      async close() {
        await connected.close();
        child.kill("SIGTERM");
        await rm(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill("SIGTERM");
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

async function connectRemoteBrowser(url: string): Promise<BrowserHandle> {
  return connectBrowser(url);
}

async function connectBrowser(url: string): Promise<BrowserHandle> {
  const cdp = await CdpClient.connect(url);
  const target = (await cdp.send("Target.createTarget", {
    url: "about:blank",
  })) as { targetId: string };
  const attached = (await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  })) as { sessionId: string };
  return {
    cdp,
    sessionId: attached.sessionId,
    async close() {
      await cdp
        .send("Target.closeTarget", { targetId: target.targetId })
        .catch(() => {});
      cdp.close();
    },
  };
}

async function waitForDocument(
  browser: BrowserHandle,
  timeout: number
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = (await browser.cdp.send(
      "Runtime.evaluate",
      { expression: "document.readyState", returnByValue: true },
      browser.sessionId
    )) as { result?: { value?: unknown } };
    if (result.result?.value === "complete") return;
    await sleep(100);
  }
  throw new CommandError(
    "browser_timeout",
    "Inspector page did not load in time."
  );
}

interface ReadyState {
  ready?: boolean;
  error?: string | null;
  errorMessage?: string | null;
  selector?: boolean;
}

/**
 * Turn the Inspector preview's polled DOM state into a failure, or
 * `undefined` when there is none yet.
 *
 * Only an explicit MCP App initialization failure (a bad resource, a
 * sandbox connect failure, an initialize-handshake failure, or a missing
 * screenshot bundle) fails the capture here — never a widget's own
 * `console.error`, uncaught error, or unhandled rejection logged after it
 * has successfully initialized. See ViewPreview.tsx in \@mcp-use/inspector.
 */
export function readyStateFailure(
  state: ReadyState | undefined
): CommandError | undefined {
  if (state?.error !== "view_load_failed") return undefined;
  return new CommandError(
    "view_load_failed",
    state.errorMessage
      ? `MCP App failed to initialize: ${state.errorMessage}`
      : "MCP App failed to initialize."
  );
}

async function waitForReady(
  browser: BrowserHandle,
  selector: string | undefined,
  timeout: number
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const expression = `(() => ({
      ready: document.body?.dataset.viewReady === "true",
      error: document.body?.dataset.viewError || null,
      errorMessage: document.body?.dataset.viewErrorMessage || null,
      selector: ${JSON.stringify(selector)} === undefined || !!document.querySelector(${JSON.stringify(selector ?? "")})
    }))()`;
    const response = (await browser.cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      browser.sessionId
    )) as { result?: { value?: ReadyState } };
    const state = response.result?.value;
    const failure = readyStateFailure(state);
    if (failure) throw failure;
    if (state?.ready === true && state.selector === true) return;
    await sleep(100);
  }
  throw new CommandError(
    "browser_timeout",
    "View did not become ready in time."
  );
}

interface CaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Read the rendered iframe's outer bounds after all requested settling time.
 * The viewport controls responsive layout; the PNG represents only the MCP
 * App surface, matching how an inline host embeds the widget.
 */
async function readCaptureBounds(
  browser: BrowserHandle
): Promise<CaptureBounds> {
  const response = (await browser.cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const frame = document.querySelector("iframe");
        if (!frame) return null;
        const rect = frame.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()`,
      returnByValue: true,
    },
    browser.sessionId
  )) as { result?: { value?: unknown } };
  return normalizeCaptureBounds(response.result?.value);
}

/** Validate and pixel-align browser-provided CSS bounds for CDP capture. */
export function normalizeCaptureBounds(value: unknown): CaptureBounds {
  if (value === null || typeof value !== "object") {
    throw new CommandError(
      "capture_failed",
      "Inspector preview did not expose rendered widget bounds."
    );
  }
  const candidate = value as Partial<CaptureBounds>;
  const numbers = [candidate.x, candidate.y, candidate.width, candidate.height];
  if (
    numbers.some(
      (number) => typeof number !== "number" || !Number.isFinite(number)
    ) ||
    candidate.width! <= 0 ||
    candidate.height! <= 0
  ) {
    throw new CommandError(
      "capture_failed",
      "Inspector preview returned invalid widget bounds."
    );
  }
  const x = Math.floor(candidate.x!);
  const y = Math.floor(candidate.y!);
  return {
    x,
    y,
    width: Math.ceil(candidate.x! + candidate.width!) - x,
    height: Math.ceil(candidate.y! + candidate.height!) - y,
  };
}

class CdpClient {
  readonly #socket: WebSocket;
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(
          new Error(message.error.message ?? "CDP command failed.")
        );
      } else {
        pending.resolve(message.result);
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("Chrome DevTools connection closed."));
      }
      this.#pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveConnection, reject) => {
      socket.addEventListener("open", () => resolveConnection(), {
        once: true,
      });
      socket.addEventListener(
        "error",
        () => reject(new Error("Could not connect to Chrome DevTools.")),
        { once: true }
      );
    });
    return new CdpClient(socket);
  }

  send(
    method: string,
    params: unknown = {},
    sessionId?: string
  ): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolveCommand, reject) => {
      this.#pending.set(id, { resolve: resolveCommand, reject });
      this.#socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId !== undefined ? { sessionId } : {}),
        })
      );
    });
  }

  close(): void {
    this.#socket.close();
  }
}

async function chromeExecutable(): Promise<string> {
  const configured =
    process.env["MCP_USE_CHROME_PATH"] ??
    process.env["PUPPETEER_EXECUTABLE_PATH"] ??
    process.env["CHROME_PATH"];
  const candidates = [
    configured,
    ...(process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            `${process.env["PROGRAMFILES"] ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["LOCALAPPDATA"] ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ]),
  ].filter(
    (candidate): candidate is string =>
      candidate !== undefined && candidate !== ""
  );
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next browser.
    }
  }
  throw new CommandError(
    "chrome_not_found",
    "Chrome, Chromium, Edge, or Brave was not found. Set MCP_USE_CHROME_PATH."
  );
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function pollJson<T>(url: string, timeout: number): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return (await response.json()) as T;
    } catch {
      // Browser is still starting.
    }
    await sleep(100);
  }
  throw new CommandError(
    "chrome_start_failed",
    "Chrome DevTools did not start."
  );
}

function parseHeaders(values: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf(":");
    if (separator <= 0) throw new UsageError(`Invalid header: ${value}`);
    headers[value.slice(0, separator).trim()] = value
      .slice(separator + 1)
      .trim();
  }
  return headers;
}

function positive(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new UsageError(`${name} must be positive.`);
  }
  return parsed;
}

function nonNegative(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`${name} must be non-negative.`);
  }
  return parsed;
}

function serializeInline(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}
