/**
 * `mcp-use dev` — a single long-lived dev process (CLI_SPEC.md § Commands →
 * dev): a Vite dev server (Environment API, node/SSR environment only) loads
 * the entry through the module runner; one HTTP listener delegates every
 * request to an atomically swappable handler reference.
 *
 * When views exist, the same Vite server gains a client environment with real
 * HMR for view files; the CLI primes views on each entry reload via the
 * internal {@link registerViews} API (VIEWS_SPEC.md § Dev).
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
import { createServer as createNodeServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createServer,
  createServerModuleRunner,
  loadConfigFromFile,
  type PluginOption,
} from "vite";
import { getRequestListener } from "@hono/node-server";

import { discoverEntry } from "./entry.js";
import { resolvePort } from "./port.js";
import { createDevApiHandler } from "./dev-api.js";
import { createTunnelManager } from "./tunnel.js";
import { resolveWorkspacePaths } from "./workspace.js";
import { mcpUseViewsPlugin } from "./views-plugin.js";
import {
  buildDevViewsManifest,
  discoverViews,
  isViewPath,
  type DiscoveredView,
} from "./views.js";
import type { ViewsManifest } from "../views/types.js";

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
  __primeViews(views: ViewsManifest, options?: { dev?: boolean; projectRoot?: string }): void;
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

const VITE_CONFIG_CANDIDATES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.cjs",
] as const;

function resolveUserViteConfig(cwd: string): string | false {
  for (const name of VITE_CONFIG_CANDIDATES) {
    const path = join(cwd, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return false;
}

/** Collect resolved plugin names from a Vite `plugins` config value. */
async function collectPluginNames(
  option: unknown,
  out: string[]
): Promise<void> {
  const value = await option;
  if (Array.isArray(value)) {
    for (const item of value) {
      await collectPluginNames(item, out);
    }
    return;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string"
  ) {
    out.push((value as { name: string }).name);
  }
}

/** Outcome of {@link resolveReactRefresh}. */
interface ReactRefreshResolution {
  /**
   * Plugins to add to the dev server — `[@vitejs/plugin-react]` when the
   * framework injects it, empty when the user config already registers it (a
   * second instance would double-wrap every component module).
   */
  plugins: PluginOption[];
  /** Whether Fast Refresh (and its virtual preamble module) is available. */
  active: boolean;
}

/**
 * Make React Fast Refresh available for view modules.
 *
 * Views are React components inside sandboxed srcdoc iframes: without Fast
 * Refresh every `view.tsx` edit falls back to Vite's `full-reload`, which
 * reloads the iframe document and wipes all component and bridge state. The
 * user's Vite config wins when it already registers `@vitejs/plugin-react`;
 * otherwise the plugin is resolved from the project (it is an optional peer
 * of this package, exactly like `vite` itself) and injected. A project
 * without it degrades to full-reload behavior with a one-line warning.
 */
async function resolveReactRefresh(
  cwd: string,
  userViteConfig: string | false
): Promise<ReactRefreshResolution> {
  if (userViteConfig !== false) {
    try {
      const loaded = await loadConfigFromFile(
        { command: "serve", mode: "development" },
        userViteConfig,
        cwd
      );
      const names: string[] = [];
      await collectPluginNames(loaded?.config.plugins, names);
      // "vite:react-refresh" is @vitejs/plugin-react's stable inner plugin
      // name — present iff the user config already provides Fast Refresh.
      if (names.includes("vite:react-refresh")) {
        return { plugins: [], active: true };
      }
    } catch {
      // A broken config file fails loudly in createServer below; here it
      // only means we could not inspect the plugin list.
    }
  }

  try {
    const projectRequire = createRequire(join(cwd, "package.json"));
    const resolved = projectRequire.resolve("@vitejs/plugin-react");
    const mod = (await import(pathToFileURL(resolved).href)) as {
      default: () => PluginOption;
    };
    return { plugins: [mod.default()], active: true };
  } catch {
    console.warn(
      "[mcp-use] @vitejs/plugin-react is not installed — view edits will " +
        "reload the whole view instead of hot-updating in place. Add it to " +
        "devDependencies to enable React Fast Refresh."
    );
    return { plugins: [], active: false };
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

  const envPath = join(options.cwd, ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const entry = discoverEntry(options.cwd, options.entry);
  let currentViews: DiscoveredView[] = discoverViews(options.cwd);
  const hasViews = () => currentViews.length > 0;
  const userViteConfig = resolveUserViteConfig(options.cwd);

  // The HTTP listener is a raw node:http server rather than
  // @hono/node-server's serve() wrapper — deliberately, and only one level
  // lower: serve() is itself createServer(getRequestListener(fetch)), and we
  // use the same getRequestListener below, so MCP traffic behaves
  // identically. Unwrapping is required because Vite's dev middleware is
  // Connect-style ((req, res, next)) with no fetch-shaped equivalent, so
  // splicing it in front of the swappable Hono handler needs the raw Node
  // request boundary. Creating the (not-yet-listening) server up front also
  // lets Vite attach its HMR websocket to this same socket (`hmr.server`
  // below) — one port total, so several `mcp-use dev` processes coexist
  // without websocket port collisions.
  const httpServer = createNodeServer();

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

  const devOrigin = `http://${host}:${port}`;

  const reactRefresh = hasViews()
    ? await resolveReactRefresh(options.cwd, userViteConfig)
    : { plugins: [], active: false };

  const vite = await createServer({
    root: options.cwd,
    configFile: hasViews() ? userViteConfig : false,
    envFile: false,
    logLevel: "warn",
    cacheDir: paths.cache,
    plugins: hasViews()
      ? [
          mcpUseViewsPlugin({
            getViews: () => currentViews,
            dev: { reactRefresh: reactRefresh.active },
          }),
          ...reactRefresh.plugins,
        ]
      : [],
    server: {
      middlewareMode: true,
      // Absolute asset URLs in dev: without `origin`, Vite emits root-relative
      // paths that resolve against the host page inside srcdoc iframes.
      ...(hasViews() && { origin: devOrigin }),
      // View HMR rides the one HTTP listener: Vite attaches its websocket
      // upgrade handler to our server, so no dedicated HMR port exists to
      // collide when several dev processes run side by side.
      hmr: hasViews() ? { server: httpServer } : false,
    },
    ssr: {
      external: true,
    },
  });

  const ssrEnvironment = vite.environments.ssr;
  const runner = createServerModuleRunner(ssrEnvironment, {
    hmr: false,
    sourcemapInterceptor: "node",
  });

  const importServer = async (): Promise<ServerLike> => {
    const moduleExports = (await runner.import(entry)) as Record<
      string,
      unknown
    >;
    const server = serverFrom(moduleExports);

    if (currentViews.length > 0) {
      const viewsManifest = buildDevViewsManifest(currentViews);
      if (typeof server.__primeViews !== "function") {
        throw new Error(
          "Loaded MCPServer instance does not support __primeViews."
        );
      }
      server.__primeViews(viewsManifest, {
        dev: true,
        projectRoot: options.cwd,
      });
    }

    return server;
  };

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

  const onSsrFileEvent = (file: string): void => {
    if (isViewPath(file, options.cwd)) {
      return;
    }
    const modules = ssrEnvironment.moduleGraph.getModulesByFile(file);
    if (modules === undefined || modules.size === 0) {
      return;
    }
    for (const mod of modules) {
      ssrEnvironment.moduleGraph.invalidateModule(mod);
    }
    reload();
  };

  const onViewFilesystemEvent = (file: string): void => {
    if (!isViewPath(file, options.cwd)) {
      return;
    }

    const previousViews = currentViews;
    currentViews = discoverViews(options.cwd);

    const viewsChanged =
      previousViews.length !== currentViews.length ||
      previousViews.some(
        (v, i) =>
          v.name !== currentViews[i]?.name ||
          v.entryPath !== currentViews[i]?.entryPath
      );

    if (viewsChanged) {
      reload();
    }
  };

  const onFileEvent = (file: string): void => {
    onViewFilesystemEvent(file);
    onSsrFileEvent(file);
  };

  vite.watcher.on("change", onFileEvent);
  vite.watcher.on("add", onFileEvent);
  vite.watcher.on("unlink", onFileEvent);

  const tunnelManager = createTunnelManager(paths.tunnel);
  const devFetch = createDevApiHandler(
    {
      getBasePath: () => basePath,
      port,
      tunnel: tunnelManager,
    },
    (request) => currentHandler(request)
  );

  // Same adapter serve() uses internally — the handler sees identical
  // requests (see the comment where httpServer is created). devFetch wraps
  // the swappable Hono handler with the dev API (tunnel control) routes.
  const honoListener = getRequestListener((request: Request) =>
    devFetch(request)
  );

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? "/";
    const pathname = new URL(url, "http://127.0.0.1").pathname;
    // View documents must come from the server's own route (per-request
    // origin resolution, no-store) — never from Vite, which would try to
    // serve/transform the .html itself.
    const isViewDocument =
      pathname.includes("/_mcp-use/views/") && pathname.endsWith(".html");
    // Vite sees module-graph URLs (/@vite/client, /@id/virtual:…,
    // /.mcp-use/cache/deps/…, view files under /resources/…) plus standard
    // node_modules pre-bundles; everything else — the MCP endpoint included —
    // goes straight to the Hono handler.
    const isViteRequest =
      req.method === "GET" &&
      (pathname.startsWith("/@") ||
        pathname.startsWith("/node_modules/") ||
        pathname.startsWith("/.mcp-use/") ||
        (hasViews() && pathname.startsWith("/resources/")));

    if (hasViews() && !isViewDocument && isViteRequest) {
      vite.middlewares(req, res, () => {
        void honoListener(req, res);
      });
    } else {
      void honoListener(req, res);
    }
  };
  httpServer.on("request", onRequest);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  console.log(`[mcp-use] dev server ready`);
  if (currentViews.length > 0) {
    console.log(
      `  ➜ Views:         ${currentViews.map((v) => v.name).join(", ")}`
    );
  }
  console.log(`  ➜ MCP endpoint:  http://localhost:${port}${basePath}`);
  console.log(`  ➜ Inspector:     http://localhost:${port}${basePath}/inspector`);

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
