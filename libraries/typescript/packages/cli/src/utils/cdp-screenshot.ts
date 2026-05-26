import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

interface CaptureScreenshotOptions {
  url: string;
  /**
   * Desired output width in CSS pixels. Optional — when omitted, the capture
   * clips to the rendered widget's natural width (read from `body[data-view-width]`
   * set by the inspector preview route). Falls back to the internal default
   * viewport width if the page didn't expose a width.
   */
  width?: number;
  /**
   * Desired output height in CSS pixels. Same semantics as `width` — omit to
   * fit the widget's natural height.
   */
  height?: number;
  theme: "light" | "dark";
  waitForSelector: string;
  timeoutMs: number;
  outputPath: string;
  /** Path to local Chrome. Required unless `cdpUrl` is supplied. */
  chromePath?: string;
  /**
   * Pre-existing CDP WebSocket URL (ws:// or wss://). When set, no local
   * Chrome is spawned — we connect directly to this endpoint. Useful for
   * driving a hosted Chromium (e.g. Notte) in sandboxed environments.
   */
  cdpUrl?: string;
  /** Extra wait after the readiness selector matches, to let animations settle. */
  delayMs?: number;
  /**
   * Device pixel ratio applied via `Emulation.setDeviceMetricsOverride`. The
   * viewport stays `width × height` in CSS pixels but the resulting PNG is
   * `(width × dsf) × (height × dsf)` device pixels — same convention as
   * Playwright/Puppeteer. Defaults to 1.
   */
  deviceScaleFactor?: number;
  /**
   * Optional pre-render bundle. When provided, it is JSON-serialized and
   * assigned to `globalThis.__mcpUsePreviewBundle` before any document
   * scripts run. The inspector preview route reads this global and renders
   * inline data instead of opening a live MCP connection from the browser.
   */
  bundle?: unknown;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

interface CdpMessage {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/**
 * Tiny CDP RPC client over a single WebSocket. Handles flat-mode session
 * routing — every call may carry a sessionId.
 */
class CdpClient {
  private nextId = 0;
  private readonly pending = new Map<number, PendingCall>();

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(data.toString()) as CdpMessage;
      } catch {
        return;
      }
      if (typeof msg.id !== "number") return;
      const cb = this.pending.get(msg.id);
      if (!cb) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        cb.reject(new Error(msg.error.message ?? "CDP error"));
      } else {
        cb.resolve(msg.result ?? {});
      }
    });
    ws.on("close", () => {
      for (const cb of this.pending.values()) {
        cb.reject(new Error("CDP WebSocket closed"));
      }
      this.pending.clear();
    });
    ws.on("error", (err) => {
      for (const cb of this.pending.values()) {
        cb.reject(err);
      }
      this.pending.clear();
    });
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<T> {
    const id = ++this.nextId;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (r) => resolve(r as T),
        reject,
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // Ignore.
    }
  }
}

/**
 * Watch Chrome's stderr for the `DevTools listening on ws://...` line that
 * Chrome prints once the debug port is bound. Rejects on timeout or premature
 * exit.
 */
function waitForDevToolsUrl(
  child: ChildProcess,
  timeoutMs = 5000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        cleanup();
        resolve(m[1]);
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `Chrome exited (code ${code}) before exposing a DevTools port. ` +
            `Last stderr: ${buf.slice(-500)}`
        )
      );
    };
    const cleanup = () => {
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`Chrome did not expose a DevTools port within ${timeoutMs}ms`)
      );
    }, timeoutMs);
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}

/**
 * Headlessly render `url` and write a PNG to disk.
 *
 * Two modes, selected by whether `opts.cdpUrl` is provided:
 *   - **Remote** (`cdpUrl` set): connect directly to an existing CDP
 *     WebSocket. No Chrome process is spawned.
 *   - **Local** (`chromePath` set): spawn Chrome with
 *     `--headless=new --remote-debugging-port=0` + throwaway user-data-dir
 *     and parse the WebSocket URL from stderr.
 *
 * After the WebSocket is connected, the flow is identical:
 *   - Open a tab via Target.createTarget, attach in flat mode.
 *   - Apply viewport + prefers-color-scheme via Emulation.* commands.
 *   - Page.navigate, then poll Runtime.evaluate for `waitForSelector`.
 *   - Page.captureScreenshot, write PNG, clean up.
 */
interface CaptureScreenshotResult {
  /** Final clip width in CSS pixels (what the PNG visually represents). */
  width: number;
  /** Final clip height in CSS pixels. */
  height: number;
}

export async function captureScreenshot(
  opts: CaptureScreenshotOptions
): Promise<CaptureScreenshotResult> {
  let userDataDir: string | undefined;
  let child: ChildProcess | undefined;
  let cdp: CdpClient | undefined;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cdp?.close();
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore.
      }
      const localChild = child;
      const killTimer = setTimeout(() => {
        if (!localChild.killed) {
          try {
            localChild.kill("SIGKILL");
          } catch {
            // Ignore.
          }
        }
      }, 2000);
      killTimer.unref();
    }
    if (userDataDir) {
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Ignore.
      }
    }
  };

  // The browser viewport (Chrome window + setDeviceMetricsOverride) must be
  // big enough to contain the widget's render box. When the caller didn't
  // specify dimensions, use a generous default so widgets have room to lay
  // out at their natural size; the final clip is narrowed afterward based on
  // either the user's explicit dimensions or the widget's reported rect.
  const DEFAULT_VIEWPORT_WIDTH = 1280;
  const DEFAULT_VIEWPORT_HEIGHT = 2000;
  const viewportWidth = Math.max(opts.width ?? 0, DEFAULT_VIEWPORT_WIDTH);
  const viewportHeight = Math.max(opts.height ?? 0, DEFAULT_VIEWPORT_HEIGHT);

  try {
    let wsUrl: string;
    if (opts.cdpUrl) {
      wsUrl = opts.cdpUrl;
    } else {
      if (!opts.chromePath) {
        throw new Error(
          "captureScreenshot requires either `cdpUrl` or `chromePath`"
        );
      }
      userDataDir = mkdtempSync(path.join(os.tmpdir(), "mcp-use-chrome-"));
      const chromeArgs = [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
        `--window-size=${viewportWidth},${viewportHeight}`,
        "about:blank",
      ];
      child = spawn(opts.chromePath, chromeArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Drain stdout so Chrome doesn't block on a full pipe.
      child.stdout?.resume();
      wsUrl = await waitForDevToolsUrl(child);
    }

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        ws.off("open", onOpen);
        reject(err);
      };
      ws.once("open", onOpen);
      ws.once("error", onError);
    });

    cdp = new CdpClient(ws);

    // We need a flat-mode sessionId attached to a page target. The two CDP
    // endpoints we support reach this differently:
    //
    //   Local Chrome: we create a fresh target and attach to it explicitly.
    //
    //   Remote endpoint (e.g. Notte): the endpoint is a browser-level WS
    //   with a pre-existing page, and explicit Target.attachToTarget is
    //   refused for security. Instead we ask for auto-attach in flat mode
    //   and pick up the sessionId from the resulting Target.attachedToTarget
    //   event. We attach the event listener BEFORE sending setAutoAttach so
    //   we don't race the event for already-existing targets.
    let sessionId: string;
    if (opts.cdpUrl) {
      const attachPromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                "Timed out waiting for Target.attachedToTarget event from remote CDP"
              )
            ),
          10_000
        );
        const onMessage = (data: WebSocket.RawData) => {
          try {
            const msg = JSON.parse(data.toString()) as {
              method?: string;
              params?: {
                sessionId?: string;
                targetInfo?: { type?: string };
              };
            };
            if (
              msg.method === "Target.attachedToTarget" &&
              msg.params?.targetInfo?.type === "page" &&
              typeof msg.params.sessionId === "string"
            ) {
              clearTimeout(timer);
              ws.off("message", onMessage);
              resolve(msg.params.sessionId);
            }
          } catch {
            // Ignore non-JSON or unrelated messages.
          }
        };
        ws.on("message", onMessage);
      });
      await cdp.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      sessionId = await attachPromise;
    } else {
      const { targetId } = await cdp.send<{ targetId: string }>(
        "Target.createTarget",
        { url: "about:blank" }
      );
      const attach = await cdp.send<{ sessionId: string }>(
        "Target.attachToTarget",
        { targetId, flatten: true }
      );
      sessionId = attach.sessionId;
    }

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: viewportWidth,
        height: viewportHeight,
        deviceScaleFactor: opts.deviceScaleFactor ?? 1,
        mobile: false,
      },
      sessionId
    );
    await cdp.send(
      "Emulation.setEmulatedMedia",
      {
        features: [
          { name: "prefers-color-scheme", value: opts.theme },
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      },
      sessionId
    );

    if (opts.bundle !== undefined) {
      // Inject the bundle as a global before any document scripts run.
      // JSON.stringify-of-JSON.stringify wraps the JSON literal as a string
      // expression so we can JSON.parse it inside the page — this avoids
      // having to escape `</script>` and other characters in the source.
      const payload = JSON.stringify(JSON.stringify(opts.bundle));
      await cdp.send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source: `globalThis.__mcpUsePreviewBundle = JSON.parse(${payload});`,
          runImmediately: true,
        },
        sessionId
      );
    }

    await cdp.send("Page.navigate", { url: opts.url }, sessionId);

    const start = Date.now();
    const exprSelector = JSON.stringify(opts.waitForSelector);
    while (true) {
      const r = await cdp.send<{
        result?: { value?: unknown };
        exceptionDetails?: unknown;
      }>(
        "Runtime.evaluate",
        {
          expression: `!!document.querySelector(${exprSelector})`,
          returnByValue: true,
        },
        sessionId
      );
      if (r.result?.value === true) break;
      if (Date.now() - start > opts.timeoutMs) {
        throw new Error(
          `Timed out after ${opts.timeoutMs}ms waiting for selector "${opts.waitForSelector}"`
        );
      }
      await new Promise((res) => setTimeout(res, 100));
    }

    if (opts.delayMs && opts.delayMs > 0) {
      await new Promise((res) => setTimeout(res, opts.delayMs));
    }

    // Prefer the widget rect that ViewPreview's bundle-mode readiness signal
    // serializes onto body[data-view-*]. When present, this lets us clip to
    // the actual rendered widget instead of the (often larger) viewport,
    // avoiding the whitespace problem when widgets are shorter than the
    // browser canvas. Falls back to the viewport when the attrs are missing
    // (e.g. live mode, or widgets that never finish loading).
    const rectResult = await cdp.send<{
      result?: {
        value?: {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        };
      };
    }>(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const d = document.body.dataset;
          const n = (s) => { const v = parseFloat(s ?? ""); return Number.isFinite(v) ? v : undefined; };
          return { x: n(d.viewX), y: n(d.viewY), width: n(d.viewWidth), height: n(d.viewHeight) };
        })()`,
        returnByValue: true,
      },
      sessionId
    );
    // Clip preference: explicit caller dimensions > widget's reported rect >
    // viewport dimensions. The widget rect's origin is used to anchor the
    // clip so even centered widgets are captured tightly.
    const rect = rectResult.result?.value ?? {};
    const clip = {
      x: rect.x ?? 0,
      y: rect.y ?? 0,
      width:
        opts.width ??
        (rect.width && rect.width > 0 ? rect.width : viewportWidth),
      height:
        opts.height ??
        (rect.height && rect.height > 0 ? rect.height : viewportHeight),
      scale: 1,
    };

    const shot = await cdp.send<{ data: string }>(
      "Page.captureScreenshot",
      {
        format: "png",
        clip,
      },
      sessionId
    );

    writeFileSync(opts.outputPath, Buffer.from(shot.data, "base64"));

    return { width: clip.width, height: clip.height };
  } finally {
    cleanup();
  }
}
