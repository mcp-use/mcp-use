/**
 * `mcp-use dev` — a single long-lived dev process (CLI_SPEC.md § Commands →
 * dev): a Vite dev server (Environment API, node/SSR environment only) loads
 * the entry through the module runner; one HTTP listener delegates every
 * request to an atomically swappable handler reference.
 *
 * Reload, not HMR: on file change the entry is re-imported and the handler
 * reference swapped — no registration diffing, no MCP notifications. Under
 * the stateless model the next request simply hits the new handler.
 *
 * `vite` is an optional peer dependency of `@mcp-use/server` (never a regular
 * dependency): this module is only ever reached through the bin's dynamic
 * `import("./cli/index.js")`, so a missing install surfaces as a rejected
 * promise there (classified by `bin/main.ts`'s `isViteMissing`), not at
 * package load time.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer, createServerModuleRunner } from "vite";
import { serve } from "@hono/node-server";

import { discoverEntry } from "./entry.js";
import { resolvePort } from "./port.js";
import { createDevApiHandler } from "./dev-api.js";
import { createTunnelManager } from "./tunnel.js";
import { resolveWorkspacePaths } from "./workspace.js";

/** Web-standard request handler, as returned by `MCPServer.getHandler()`. */
type FetchHandler = (request: Request) => Promise<Response>;

/**
 * The duck-typed shape the entry's default export must satisfy: an
 * `MCPServer` instance (checked structurally so the runner may load its own
 * copy of `@mcp-use/server`).
 */
interface ServerLike {
  getHandler(): FetchHandler;
  /** URL path prefix the MCP endpoint is mounted at (default `"/mcp"`). */
  readonly basePath?: string;
}

/**
 * Options for {@link runDev}.
 *
 * @internal
 */
export interface DevOptions {
  /** Absolute path to the project root. */
  cwd: string;
  /**
   * Explicit entry path (the `--entry` flag), absolute or relative to `cwd`.
   *
   * @defaultValue Conventional discovery: `src/index.ts`, `src/server.ts`,
   * `index.ts`, `server.ts` — first hit wins.
   */
  entry?: string;
  /**
   * Preferred port. When taken, the next free port upward is used (and the
   * substitution logged).
   *
   * @defaultValue The `PORT` environment variable, else `3000`.
   */
  port?: number;
  /**
   * Host to bind.
   *
   * @defaultValue `"127.0.0.1"` (matching the server's localhost-first posture).
   */
  host?: string;
  /**
   * Abort signal for embedding and tests: aborting shuts the dev process
   * down gracefully (same path as SIGINT/SIGTERM). The CLI itself does not
   * pass this.
   */
  signal?: AbortSignal;
  /**
   * When `true`, start a public tunnel as soon as the HTTP listener is bound
   * (same as the inspector "Start Tunnel" control, but at startup).
   *
   * @defaultValue `false`
   */
  tunnel?: boolean;
  /**
   * Auto-open the inspector in the default browser once the listener is
   * bound (`--no-open` sets this to `false`). Opening is additionally
   * skipped when stdout is not a TTY — agents and CI never get a spurious
   * browser launch or a "failed to open" error.
   *
   * @defaultValue `true`
   */
  open?: boolean;
}

/**
 * Best-effort open of `url` in the platform's default browser.
 *
 * Dependency-free (`open`/`start`/`xdg-open` via spawn), detached, and
 * error-swallowing: a missing opener (headless Linux, containers) must never
 * crash or log noise into the dev process.
 */
function openInBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? // `start` is a cmd built-in; the empty string is the window title.
          ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      // Swallow: auto-open is a convenience, never a failure.
    });
    child.unref();
  } catch {
    // Synchronous spawn failures are equally non-fatal.
  }
}

/**
 * Validate the entry module's default export and return it as a
 * {@link ServerLike}.
 */
function serverFrom(moduleExports: Record<string, unknown>): ServerLike {
  const server = moduleExports["default"];
  if (server === null || typeof server !== "object") {
    throw new Error(
      "The server entry must default-export the MCPServer instance " +
        "(`export default server`) and never call listen() itself — " +
        "`mcp-use dev` owns the socket."
    );
  }
  const candidate = server as Partial<ServerLike>;
  if (typeof candidate.getHandler !== "function") {
    throw new Error(
      "The entry's default export has no getHandler() — it must be the " +
        "MCPServer instance (`export default server`)."
    );
  }
  return candidate as ServerLike;
}

/**
 * Run the dev server: import the entry through Vite's module runner (full
 * TS/alias support), serve `server.getHandler()` on one long-lived HTTP
 * listener, and swap the handler on file change.
 *
 * A throwing re-import keeps the previous handler alive and prints the error
 * — the dev process never crashes on a bad save. `.env` (if present) is
 * loaded from `cwd` via `process.loadEnvFile()` before the entry is first
 * imported.
 *
 * The returned promise resolves after a graceful shutdown (SIGINT/SIGTERM or
 * `options.signal` aborting).
 *
 * @param options - Project root, optional entry override, port and host.
 * @throws If no entry is found, if the initial import fails, if the entry's
 * default export is not an `MCPServer` (see the entry contract in
 * CLI_SPEC.md), or if `vite` is not installed (`mcp-use dev` requires it as a
 * devDependency).
 *
 * @internal Reached only via the bin's `import("./cli/index.js")`
 * dispatch (`bin/main.ts`) — not re-exported from the package's "." entry.
 */
export async function runDev(options: DevOptions): Promise<void> {
  const host = options.host ?? "127.0.0.1";
  const paths = resolveWorkspacePaths(options.cwd);

  // Load .env before the entry is imported so module-scope code sees it.
  // `loadEnvFile` throws ENOENT when the file is missing, unlike dotenv's
  // silent no-op — guard explicitly to preserve that behavior.
  const envPath = join(options.cwd, ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  // Resolve the listener before importing the entry so module-scope OAuth
  // configuration observes the canonical port that this CLI will own.
  const requestedPort =
    options.port ??
    (process.env["PORT"] !== undefined
      ? Number.parseInt(process.env["PORT"], 10)
      : 3000);
  const { port, requested } = await resolvePort(requestedPort, host);
  if (port !== requested) {
    console.log(`[mcp-use] port ${requested} is taken, using ${port}`);
  }
  process.env["PORT"] = String(port);

  const localFallbackMcpUrl =
    process.env["MCP_URL"] === undefined &&
    (host === "127.0.0.1" || host === "localhost" || host === "::1")
      ? `http://localhost:${port}`
      : undefined;

  const entry = discoverEntry(options.cwd, options.entry);

  const vite = await createServer({
    root: options.cwd,
    configFile: false,
    envFile: false,
    logLevel: "warn",
    cacheDir: paths.cache,
    server: {
      // We never use Vite's HTTP server; middleware mode keeps it unbound.
      middlewareMode: true,
      // Reload, not HMR (CLI_SPEC.md § Why no HMR).
      hmr: false,
    },
    ssr: {
      // Match the build: every bare import resolves from node_modules.
      external: true,
    },
  });

  const environment = vite.environments.ssr;
  const runner = createServerModuleRunner(environment, {
    hmr: false,
    sourcemapInterceptor: "node",
  });

  const importServer = async (): Promise<ServerLike> => {
    if (localFallbackMcpUrl === undefined) {
      return serverFrom(await runner.import(entry));
    }

    // This is safe only because this CLI selected and will bind this local
    // listener. Never derive OAuth identity from an untrusted request Host.
    // Scope it to entry evaluation: MCPServer freezes the trusted canonical
    // resource during construction, while later runtime code must not inherit
    // this CLI-owned synthetic environment value.
    const previousMcpUrl = process.env["MCP_URL"];
    try {
      process.env["MCP_URL"] = localFallbackMcpUrl;
      return serverFrom(await runner.import(entry));
    } finally {
      if (previousMcpUrl === undefined) {
        delete process.env["MCP_URL"];
      } else {
        process.env["MCP_URL"] = previousMcpUrl;
      }
    }
  };

  // Initial import must succeed — fail loudly before binding the socket.
  let currentHandler: FetchHandler;
  let basePath: string;
  try {
    const server = await importServer();
    currentHandler = server.getHandler();
    basePath = server.basePath ?? "/mcp";
  } catch (error) {
    await runner.close();
    await vite.close();
    throw error;
  }

  // --- Reload on file change (serialized; a failed reload keeps the old
  // handler; changes during a reload trigger one follow-up pass). -----------
  let reloading = false;
  let dirty = false;
  const reload = (): void => {
    if (reloading) {
      dirty = true;
      return;
    }
    reloading = true;
    void (async () => {
      do {
        dirty = false;
        try {
          // Drop every evaluated module so the re-import sees current code
          // (the server-side transform cache was already invalidated by the
          // watcher); then swap the handler reference atomically.
          runner.evaluatedModules.clear();
          const server = await importServer();
          currentHandler = server.getHandler();
          basePath = server.basePath ?? "/mcp";
          console.log("[mcp-use] reloaded server entry");
        } catch (error) {
          console.error(
            "[mcp-use] reload failed — keeping the previous server:\n",
            error
          );
        }
      } while (dirty);
      reloading = false;
    })();
  };

  const onFileEvent = (file: string): void => {
    // Only files in the entry's module graph matter (the watcher also sees
    // unrelated project files).
    const modules = environment.moduleGraph.getModulesByFile(file);
    if (modules === undefined || modules.size === 0) {
      return;
    }
    for (const mod of modules) {
      environment.moduleGraph.invalidateModule(mod);
    }
    reload();
  };
  vite.watcher.on("change", onFileEvent);
  vite.watcher.on("add", onFileEvent);
  vite.watcher.on("unlink", onFileEvent);

  // --- One long-lived HTTP listener delegating to the current handler. -----
  const tunnelManager = createTunnelManager(paths.tunnel);
  const devFetch = createDevApiHandler(
    {
      getBasePath: () => basePath,
      port,
      tunnel: tunnelManager,
    },
    (request) => currentHandler(request)
  );

  const httpServer = await new Promise<ReturnType<typeof serve>>(
    (resolve, reject) => {
      const server = serve(
        {
          fetch: (request: Request) => devFetch(request),
          port,
          hostname: host,
        },
        () => resolve(server)
      );
      server.once("error", reject);
    }
  );

  // basePath was introspected from the loaded MCPServer instance above.
  console.log(`[mcp-use] dev server ready`);
  console.log(`  ➜ MCP endpoint:  http://localhost:${port}${basePath}`);
  console.log(
    `  ➜ Inspector:     http://localhost:${port}${basePath}/inspector`
  );

  if (options.tunnel === true) {
    try {
      const { url } = await tunnelManager.start(port);
      console.log(`  ➜ Tunnel:        ${url}${basePath}`);
    } catch (error) {
      await tunnelManager.stop();
      await new Promise<void>((done) => httpServer.close(() => done()));
      await runner.close();
      await vite.close();
      throw error;
    }
  }

  // Auto-open the inspector — unless disabled (`--no-open`) or stdout is not
  // a TTY (agents/CI: no browser to open, and no error to fail on).
  if (options.open !== false && process.stdout.isTTY === true) {
    openInBrowser(`http://localhost:${port}${basePath}/inspector`);
  }

  // --- Graceful shutdown (SIGINT/SIGTERM or options.signal). ---------------
  await new Promise<void>((resolve) => {
    let closing = false;
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      void (async () => {
        vite.watcher.off("change", onFileEvent);
        vite.watcher.off("add", onFileEvent);
        vite.watcher.off("unlink", onFileEvent);
        await tunnelManager.stop();
        await new Promise<void>((done) => httpServer.close(() => done()));
        await runner.close();
        await vite.close();
        resolve();
      })();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        shutdown();
      } else {
        options.signal.addEventListener("abort", shutdown, { once: true });
      }
    }
  });
}
