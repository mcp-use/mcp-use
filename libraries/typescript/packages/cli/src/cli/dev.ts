/**
 * `mcp-use dev` — a single long-lived dev process: a Vite dev server
 * (Environment API, node/SSR environment only) loads
 * the entry through the module runner; one HTTP listener delegates every
 * request to an atomically swappable handler reference.
 *
 * When views exist, the same Vite server gains a client environment with real
 * HMR for view files; the CLI primes views on each entry reload via the
 * internal {@link registerViews} API.
 *
 * Reload, not HMR: on file change the entry is re-imported and the handler
 * reference swapped — no registration diffing or running-registry mutation.
 * All handler generations share one event bus, so a successful swap invalidates
 * the tool, prompt, and resource lists for subscribed development clients.
 *
 * This module is reached only through the bin's dedicated dynamic dev import,
 * so library consumers and production startup never evaluate Vite.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer, createServerModuleRunner, normalizePath } from "vite";
// Bundled into the lazy dev chunk; keeping this build input in devDependencies
// prevents the standalone CLI from installing the full SDK dependency tree.
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  InMemoryServerEventBus,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type ServerEventBus,
  validateHostHeader,
  validateOriginHeader,
} from "@modelcontextprotocol/server";
import { openBrowser } from "./open-browser.js";

import {
  resolveHost,
  resolvePort as resolvePreferredPort,
} from "../bin/args.js";
import { discoverEntry } from "./entry.js";
import { resolveDevClientEndpoint } from "./dev-client-endpoint.js";
import {
  loadProjectEnv,
  nextStandaloneCompatPlugin,
  nextStandaloneSsrOptions,
} from "./next-compat.js";
import { resolvePort } from "./port.js";
import { resolveTailwindCss, resolveUserViteConfig } from "./vite-config.js";
import { createDevApiHandler } from "./dev-api.js";
import {
  loadProjectInspector,
  type DevInspectorHandler,
  type ProjectInspectorModule,
} from "./inspector.js";
import { isInspectorPath, isInspectorRequest } from "./inspector-route.js";
// Bundled into the CLI artifact without becoming a runtime dependency.
// eslint-disable-next-line import/no-extraneous-dependencies
import { createTunnelManager } from "@mcp-use/tunnel";
import { syncMcpEnvDeclaration } from "./mcp-env-declaration.js";
import { resolveWorkspacePaths } from "./workspace.js";
import {
  mcpUseViewsPlugin,
  VIEW_REACT_DEDUPE,
  VIEW_REACT_OPTIMIZE_DEPS,
} from "./views-plugin.js";
import {
  buildDevViewsManifest,
  discoverViews,
  isViewPath,
  resolveViewsDir,
  type DiscoveredView,
} from "./views.js";
import type { ViewsManifest } from "../views/types.js";
import type { SkillsOptions, SkillsSnapshot } from "../skills/types.js";
import {
  discoverConfiguredSkills,
  resolveConfiguredSkillsDirectory,
} from "../skills/node-loader.js";

/** Canonical Web handler exposed by `MCPServer.fetch`. */
type WebHandler = (request: Request) => Promise<Response>;

/** Coalesce one editor save burst before reconciling a project generation. */
const RELOAD_SETTLE_MS = 50;

/** Whether two discovery snapshots describe the same view module graph. */
function sameDiscoveredViews(
  left: readonly DiscoveredView[],
  right: readonly DiscoveredView[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (view, index) =>
        view.name === right[index]?.name &&
        view.entryPath === right[index]?.entryPath
    )
  );
}

/**
 * The duck-typed shape the entry's default export must satisfy: an
 * `MCPServer` instance (checked structurally so the runner may load its own
 * copy of `mcp-use`).
 */
interface ServerLike {
  fetch(request: Request): Response | Promise<Response>;
  __setEventBus(bus: ServerEventBus): void;
  __setRequestLogPrefix(prefix: string | undefined): void;
  __mount(): void;
  /** URL path prefix the MCP endpoint is mounted at (default `"/mcp"`). */
  readonly basePath?: string;
  __primeViews(
    views: ViewsManifest,
    options?: { dev?: boolean; projectRoot?: string }
  ): void;
  __primeSkills(snapshot: SkillsSnapshot | undefined): void;
  __skillsConfig(): boolean | SkillsOptions | undefined;
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
  /** Directory containing the conventional entry and, by default, views/. */
  mcpDir?: string;
  /** Explicit views directory, absolute or relative to `cwd`. */
  viewsDir?: string;
  /**
   * Preferred port. When taken, the next free port upward is used (and the
   * substitution logged).
   *
   * @defaultValue The `PORT` environment variable, else `3000`.
   */
  port?: number;
  /**
   * Interface address to bind — `"0.0.0.0"` exposes the dev server to the
   * local network (phones, containers, teammates); the default keeps it
   * machine-local. Printed and auto-opened URLs use `localhost` for
   * loopback/wildcard binds and the given host verbatim otherwise.
   *
   * Localhost-class binds get DNS-rebinding protection: every request's
   * `Host` is validated (plus the active tunnel hostname); `Origin` only on
   * non-GET/HEAD. Non-localhost binds skip validation — the legitimate
   * hostnames are unknowable here — and log a warning instead.
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
  /**
   * Load and mount the project-local `@mcp-use/inspector` package.
   *
   * Missing optional tooling produces an install hint while the MCP endpoint
   * continues running. Set to `false` with `--no-inspector` for headless work.
   *
   * @defaultValue `true`
   */
  inspector?: boolean;
}

/**
 * Best-effort open of `url` in the platform's default browser.
 *
 * Dependency-free (`open`/`start`/`xdg-open` via spawn), detached, and
 * error-swallowing: a missing opener (headless Linux, containers) must never
 * crash or log noise into the dev process.
 */
function openInBrowser(url: string): void {
  openBrowser(url);
}

/**
 * First non-internal IPv4 address of this machine, for the "Network:" line
 * printed on wildcard binds — `undefined` when offline.
 */
function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal && address.family === "IPv4") {
        return address.address;
      }
    }
  }
  return undefined;
}

/** Parse a Host header into a bracket-free hostname for local-route policy. */
function hostnameFromHostHeader(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return undefined;
  }
}

/**
 * Merge `Origin` into an existing `Vary` header without duplicating it.
 *
 * @param res - Node response whose `Vary` may already list other tokens.
 */
function appendVaryOrigin(res: ServerResponse): void {
  const existing = res.getHeader("Vary");
  const current =
    typeof existing === "string"
      ? existing
      : Array.isArray(existing)
        ? existing.join(", ")
        : existing !== undefined
          ? String(existing)
          : "";
  if (
    current
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .includes("origin")
  ) {
    return;
  }
  res.setHeader("Vary", current === "" ? "Origin" : `${current}, Origin`);
}

/**
 * CORS for Vite-served module-graph URLs on the dev listener.
 *
 * Tunnel active → `Access-Control-Allow-Origin: *` (foreign / opaque hosts).
 * Public/wildcard bind → `*` (the listener is intentionally network-visible).
 * No tunnel on a localhost bind → reflect a validated loopback `Origin`
 * (exact value) and set `Vary: Origin`; reflect `null` for opaque sandbox
 * iframes; foreign or missing Origin get no ACAO.
 *
 * @param req - Incoming request (reads `Origin`).
 * @param res - Response to receive CORS headers.
 * @param options - `tunnelActive` when a public tunnel URL is set;
 *   `localhostBind` when the listener is on a loopback host.
 */
function applyViteModuleCors(
  req: IncomingMessage,
  res: ServerResponse,
  options: { tunnelActive: boolean; localhostBind: boolean }
): void {
  if (options.tunnelActive) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return;
  }
  if (!options.localhostBind) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return;
  }
  const originHeader = req.headers.origin;
  // Sandboxed MCP App iframes (opaque origin) send `Origin: null` on module GETs.
  if (originHeader === "null") {
    res.setHeader("Access-Control-Allow-Origin", "null");
    return;
  }
  // validateOriginHeader treats a missing Origin as ok (no header to check);
  // CORS reflection requires a concrete loopback origin string.
  if (typeof originHeader !== "string" || originHeader === "") {
    return;
  }
  const result = validateOriginHeader(originHeader, localhostAllowedOrigins());
  if (!result.ok || result.origin === undefined) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", result.origin);
  appendVaryOrigin(res);
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
  if (typeof candidate.fetch !== "function") {
    throw new Error(
      "The entry's default export has no fetch() — it must be the " +
        "MCPServer instance (`export default server`)."
    );
  }
  return candidate as ServerLike;
}

/**
 * Run the dev server: import the entry through Vite's module runner (full
 * TS/alias support), serve `server.fetch` on one long-lived HTTP
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
 * default export is not an `MCPServer`, or if `vite` is not installed
 * (`mcp-use dev` requires it as a devDependency).
 *
 * @internal Reached only via the bin's dedicated dev command chunk — not
 * re-exported from the package's "." entry.
 */
export async function runDev(options: DevOptions): Promise<void> {
  process.env.MCP_USE_DEV_CLI = "1";
  const paths = resolveWorkspacePaths(options.cwd);
  const eventBus = new InMemoryServerEventBus((error) => {
    console.error("[mcp-use] notification delivery failed:", error);
  });

  loadProjectEnv(options.cwd, "development");
  const host = resolveHost(options.host);
  const localhostBind = ["127.0.0.1", "localhost", "::1"].includes(host);
  const wildcardBind = host === "0.0.0.0" || host === "::";

  // Resolve the listener before importing the entry so module-scope OAuth
  // configuration observes the canonical port that this CLI will own.
  // The HTTP listener is a raw node:http server with the vendored
  // toNodeHandler bridge — same role as the old @hono/node-server
  // getRequestListener, without a hono dependency.
  // Connect-style ((req, res, next)) with no fetch-shaped equivalent, so
  // splicing it in front of the swappable fetch handler needs the raw Node
  // request boundary. Creating the (not-yet-listening) server up front also
  // lets Vite attach its HMR websocket to this same socket (`hmr.server`
  // below) — one port total, so several `mcp-use dev` processes coexist
  // without websocket port collisions.
  const httpServer = createNodeServer();

  const { port, requested } = await resolvePort(
    resolvePreferredPort(options.port),
    host
  );
  if (port !== requested) {
    console.log(`[mcp-use] port ${requested} is taken, using ${port}`);
  }
  process.env["PORT"] = String(port);

  const localFallbackMcpUrl =
    process.env["MCP_URL"] === undefined &&
    (host === "127.0.0.1" || host === "localhost" || host === "::1")
      ? `http://localhost:${port}`
      : undefined;

  const sourceRoot =
    options.mcpDir === undefined
      ? options.cwd
      : resolve(options.cwd, options.mcpDir);
  const entry =
    options.entry === undefined
      ? discoverEntry(sourceRoot)
      : discoverEntry(options.cwd, options.entry);
  const declarationStatus = await syncMcpEnvDeclaration(options.cwd, entry);
  if (declarationStatus === "created" || declarationStatus === "updated") {
    console.log(`[mcp-use] ${declarationStatus} mcp-env.d.ts`);
  }
  const viewsDirectory =
    options.viewsDir ??
    (options.mcpDir === undefined ? undefined : join(options.mcpDir, "views"));
  const conventionalSkillsDirectory =
    options.mcpDir === undefined ? "skills" : join(options.mcpDir, "skills");
  if (!existsSync(resolveViewsDir(options.cwd, viewsDirectory))) {
    console.log("[mcp-use] views directory not configured.");
  }
  let currentViews: DiscoveredView[] = discoverViews(
    options.cwd,
    viewsDirectory
  );
  // The Vite client environment (views plugin, Fast Refresh, HMR socket,
  // asset origin) is configured once, from this snapshot. `currentViews`
  // stays live for request routing and re-priming, but a project that starts
  // with zero views needs a dev-server restart to pick up its first view.
  const viewsAtStartup = currentViews.length > 0;
  const userViteConfig = resolveUserViteConfig(options.cwd);

  const devClientEndpoint = resolveDevClientEndpoint(
    host,
    port,
    process.env["MCP_URL"]
  );

  const vite = await createServer({
    root: options.cwd,
    configFile: viewsAtStartup ? userViteConfig : false,
    envDir: false,
    logLevel: "warn",
    cacheDir: paths.cache,
    resolve: {
      tsconfigPaths: true,
      alias: { tailwindcss: resolveTailwindCss() },
      // Inline Vite config is applied after plugin config hooks. Keep this
      // invariant at the final merge layer so the optimizer and transformed
      // view source cannot receive distinct React module URLs.
      dedupe: VIEW_REACT_DEDUPE,
    },
    // Pre-bundling mcp-use/react makes its internal React import resolve to an
    // unversioned optimizer URL while view source receives a versioned URL.
    // Serving the framework entry as ESM keeps both imports on one dispatcher;
    // its CommonJS ReactDOM dependency still needs explicit optimization.
    // Tool-only projects do not load a browser view graph. Avoid starting a
    // dependency optimizer for them: on Windows its background cache commit
    // can otherwise outlive Vite shutdown and race fixture/project cleanup.
    ...(viewsAtStartup && { optimizeDeps: VIEW_REACT_OPTIMIZE_DEPS }),
    oxc: { jsx: { runtime: "automatic" } },
    plugins: viewsAtStartup
      ? [
          nextStandaloneCompatPlugin(options.cwd),
          tailwindcss(),
          mcpUseViewsPlugin({
            getViews: () => currentViews,
            dev: { reactRefresh: true },
          }),
          react(),
        ]
      : [nextStandaloneCompatPlugin(options.cwd)],
    server: {
      middlewareMode: true,
      watch: {
        // Vibe captures the managed dev process output in the project root.
        // Watching that continuously-written operational file makes Vite
        // broadcast `full-reload` forever, so srcdoc view guests repeatedly
        // remount and surface a compiling spinner instead of Fast Refresh.
        ignored: "**/.dev-server-logs.txt",
      },
      // A public/wildcard bind deliberately accepts hostnames that are only
      // known to the surrounding platform (for example a sandbox URL). Keep
      // Vite's own static Host allowlist aligned with the listener boundary;
      // localhost binds retain the stricter default and our dynamic tunnel
      // path rewrites an authorized tunnel Host to localhost below.
      ...(!localhostBind && { allowedHosts: true }),
      // Absolute asset URLs in dev: without `origin`, Vite emits root-relative
      // paths that resolve against the host page inside srcdoc iframes.
      ...(viewsAtStartup && { origin: devClientEndpoint.origin }),
      // CORS on module URLs is owned by onRequest below (permissive ACAO
      // only while the tunnel is active), not by Vite's own middleware —
      // whose default localhost-only policy would block tunnel-rendering
      // hosts, and whose headers would fight the tunnel-gated ones.
      cors: false,
      // View HMR rides the one HTTP listener: Vite attaches its websocket
      // upgrade handler to our server, so no dedicated HMR port exists to
      // collide when several dev processes run side by side.
      hmr: viewsAtStartup
        ? { server: httpServer, ...devClientEndpoint.hmr }
        : false,
      // Vite 8's Environment API keeps its WebSocket transport enabled when
      // only `hmr: false` is set. Zero-view servers need no socket at all.
      ...(!viewsAtStartup && { ws: false }),
    },
    ssr: {
      ...nextStandaloneSsrOptions(options.cwd),
    },
  });

  const ssrEnvironment = vite.environments.ssr;
  const runner = createServerModuleRunner(ssrEnvironment, {
    hmr: false,
    sourcemapInterceptor: "node",
  });

  const importServer = async (
    viewsSnapshot: DiscoveredView[]
  ): Promise<{
    server: ServerLike;
    skillsDirectory: string | undefined;
  }> => {
    const load = async (): Promise<{
      server: ServerLike;
      skillsDirectory: string | undefined;
    }> => {
      const moduleExports = (await runner.import(entry)) as Record<
        string,
        unknown
      >;
      const server = serverFrom(moduleExports);
      const skillsConfig = server.__skillsConfig();
      const skillsDirectory = resolveConfiguredSkillsDirectory(
        skillsConfig,
        options.cwd,
        conventionalSkillsDirectory
      );
      server.__primeSkills(
        discoverConfiguredSkills(
          skillsConfig,
          options.cwd,
          conventionalSkillsDirectory,
          {
            onInvalidSkill: (error) => {
              const message = error.message.replace(/\s+/g, " ").trim();
              console.error(`[mcp-use] invalid skill omitted: ${message}`);
            },
          }
        )
      );
      const viewsManifest = buildDevViewsManifest(viewsSnapshot);
      if (typeof server.__primeViews !== "function") {
        throw new Error(
          "Loaded MCPServer instance does not support __primeViews."
        );
      }
      server.__primeViews(viewsManifest, {
        dev: true,
        projectRoot: options.cwd,
      });

      return { server, skillsDirectory };
    };

    if (localFallbackMcpUrl === undefined) {
      return load();
    }

    // This is safe only because this CLI selected and will bind this local
    // listener. Never derive OAuth identity from an untrusted request Host.
    // Scope it to entry evaluation: MCPServer freezes the trusted canonical
    // resource during construction, while later runtime code must not inherit
    // this CLI-owned synthetic environment value.
    const previousMcpUrl = process.env["MCP_URL"];
    try {
      process.env["MCP_URL"] = localFallbackMcpUrl;
      return await load();
    } finally {
      if (previousMcpUrl === undefined) {
        delete process.env["MCP_URL"];
      } else {
        process.env["MCP_URL"] = previousMcpUrl;
      }
    }
  };

  let inspectorModule: ProjectInspectorModule | undefined;
  let inspectorHandler: DevInspectorHandler | undefined;
  let inspectorMountPath: string | undefined;

  const mountDevInspector = (nextBasePath: string): void => {
    if (inspectorModule === undefined || inspectorMountPath === nextBasePath) {
      return;
    }
    const mounted = inspectorModule.mountInspector({
      basePath: nextBasePath,
      autoConnectUrl: `${devClientEndpoint.origin}${nextBasePath}`,
      oauthProxyAllowLoopback: localhostBind || wildcardBind,
      devMode: true,
      manufactChatUrl: process.env["MANUFACT_CHAT_URL"],
      logPrefix: "[inspector]",
    });
    if (typeof mounted !== "function") {
      throw new Error(
        "The installed @mcp-use/inspector is incompatible: " +
          "mountInspector() did not return a Fetch handler."
      );
    }
    inspectorHandler = mounted;
    inspectorMountPath = nextBasePath;
  };

  let currentHandler: WebHandler;
  let basePath: string;
  let currentSkillsDirectory: string | undefined;
  try {
    const { server, skillsDirectory } = await importServer(currentViews);
    server.__setEventBus(eventBus);
    basePath = server.basePath ?? "/mcp";
    if (options.inspector !== false) {
      const loadedInspector = await loadProjectInspector(options.cwd);
      if (loadedInspector.installed) {
        inspectorModule = loadedInspector.module;
        mountDevInspector(basePath);
      }
    }
    server.__setRequestLogPrefix(
      inspectorHandler === undefined ? undefined : "[server]"
    );
    server.__mount();
    currentHandler = async (request) => server.fetch(request);
    currentSkillsDirectory = skillsDirectory;
  } catch (error) {
    await runner.close();
    await vite.close();
    throw error;
  }

  let desiredRevision = 0;
  let reconciling = false;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  let viewsDiscoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let skillsReloadTimer: ReturnType<typeof setTimeout> | undefined;
  const isAborted = (): boolean => options.signal?.aborted === true;

  /**
   * Reconcile one immutable project generation. A candidate prepared from an
   * older watcher revision is discarded before it can swap the active handler,
   * publish catalog invalidations, or report a terminal failure.
   */
  const reconcile = async (): Promise<void> => {
    if (reconciling) return;
    reconciling = true;
    try {
      while (!isAborted()) {
        const revision = desiredRevision;
        const viewsSnapshot = discoverViews(options.cwd, viewsDirectory);
        try {
          runner.evaluatedModules.clear();
          const { server, skillsDirectory } = await importServer(viewsSnapshot);
          server.__setEventBus(eventBus);
          server.__setRequestLogPrefix(
            inspectorHandler === undefined ? undefined : "[server]"
          );
          server.__mount();

          if (isAborted()) return;
          if (revision !== desiredRevision) continue;

          const nextHandler: WebHandler = async (request) =>
            server.fetch(request);
          const nextBasePath = server.basePath ?? "/mcp";
          mountDevInspector(nextBasePath);
          currentViews = [...viewsSnapshot];
          currentHandler = nextHandler;
          basePath = nextBasePath;
          currentSkillsDirectory = skillsDirectory;
          if (currentSkillsDirectory !== undefined) {
            vite.watcher.add(currentSkillsDirectory);
          }
          eventBus.publish({ kind: "tools_list_changed" });
          eventBus.publish({ kind: "prompts_list_changed" });
          eventBus.publish({ kind: "resources_list_changed" });
          console.log("[mcp-use] reloaded server entry");
          return;
        } catch (error) {
          if (isAborted()) return;
          if (revision !== desiredRevision) continue;
          const message = (
            error instanceof Error ? error.message : String(error)
          )
            .replace(/\s+/g, " ")
            .trim();
          console.error(
            `[mcp-use] reload failed — keeping the previous server: ${message}`
          );
          return;
        }
      }
    } finally {
      reconciling = false;
    }
  };

  const scheduleReconcile = (): void => {
    desiredRevision += 1;
    if (reloadTimer !== undefined) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      void reconcile();
    }, RELOAD_SETTLE_MS);
  };

  const scheduleSkillsReload = (): void => {
    if (skillsReloadTimer !== undefined) clearTimeout(skillsReloadTimer);
    // Editors and scaffolding tools commonly create/rename a skill and then
    // write SKILL.md in several filesystem operations. Let that short burst
    // settle so discovery does not validate an intermediate empty file.
    skillsReloadTimer = setTimeout(() => {
      skillsReloadTimer = undefined;
      scheduleReconcile();
    }, 150);
  };

  const onSsrFileEvent = (file: string): void => {
    const normalizedFile = file.replaceAll("\\", "/");
    // Skills may intentionally live under the views root. Give that configured
    // data directory precedence before view files take the HMR-only path.
    if (
      currentSkillsDirectory !== undefined &&
      (normalizedFile === currentSkillsDirectory.replaceAll("\\", "/") ||
        normalizedFile.startsWith(
          `${currentSkillsDirectory.replaceAll("\\", "/")}/`
        ))
    ) {
      scheduleSkillsReload();
      return;
    }
    if (isViewPath(file, options.cwd, viewsDirectory)) {
      return;
    }
    const modules = ssrEnvironment.moduleGraph.getModulesByFile(
      normalizePath(file)
    );
    if (modules === undefined || modules.size === 0) {
      return;
    }
    for (const mod of modules) {
      ssrEnvironment.moduleGraph.invalidateModule(mod);
    }
    scheduleReconcile();
  };

  const scheduleViewsRediscovery = (): void => {
    if (viewsDiscoveryTimer !== undefined) clearTimeout(viewsDiscoveryTimer);
    // Remote editors commonly save by replacing the file, which can surface
    // as unlink + add instead of change. Let the save burst settle and only
    // rebuild the MCP server when the discovered view registry actually
    // changed. Content-only replacements remain on Vite's client HMR path,
    // preserving the mounted view and its React state.
    viewsDiscoveryTimer = setTimeout(() => {
      viewsDiscoveryTimer = undefined;
      const discovered = discoverViews(options.cwd, viewsDirectory);
      if (!sameDiscoveredViews(currentViews, discovered)) {
        scheduleReconcile();
      }
    }, RELOAD_SETTLE_MS);
  };

  const onViewFilesystemEvent = (file: string): void => {
    if (!isViewPath(file, options.cwd, viewsDirectory)) {
      return;
    }

    scheduleViewsRediscovery();
  };

  const onFileAddOrUnlink = (file: string): void => {
    onViewFilesystemEvent(file);
    onSsrFileEvent(file);
  };

  // A `change` event cannot add or remove a view directory, so only
  // `add`/`unlink` rescan `views/` — content edits never pay for the
  // synchronous filesystem walk in discoverViews().
  vite.watcher.on("change", onSsrFileEvent);
  vite.watcher.on("add", onFileAddOrUnlink);
  vite.watcher.on("unlink", onFileAddOrUnlink);
  // Skill files are data, not server-module imports, so Vite does not
  // necessarily watch their directory until we opt it in explicitly.
  // Watching the configured root also covers a conventional skills/ folder
  // created after the dev server has already started.
  if (currentSkillsDirectory !== undefined) {
    vite.watcher.add(currentSkillsDirectory);
  }

  // --- One long-lived HTTP listener delegating to the current handler. -----
  const tunnelManager = createTunnelManager(paths.tunnel);

  // Vite owns the upgrade listener and validates Host before our HTTP request
  // guard runs. The public tunnel has already been validated by the proxy and
  // tunnel manager, so present only that active host as the local listener.
  httpServer.prependListener("upgrade", (req) => {
    const tunnelUrl = tunnelManager.status().url;
    if (tunnelUrl === null) return;
    const tunnelHost = new URL(tunnelUrl).hostname;
    const requestHost = req.headers.host?.split(":")[0];
    if (requestHost === tunnelHost) {
      req.headers.host = `localhost:${port}`;
    }
  });

  // --- DNS-rebinding protection. --------------------------------------------
  // server.fetch applies no Host/Origin validation (its contract assumes a
  // platform edge in front); in dev this process *is* the edge, so
  // localhost-class binds get the same localhost-allowlist checks listen()
  // applies — extended with the active tunnel hostname, since tunnel traffic
  // arrives with the tunnel's public Host. The check runs before any routing,
  // covering the MCP endpoint, the dev API (tunnel control), and Vite-served
  // module URLs alike. Non-localhost binds get no validation (the legitimate
  // hostnames are unknowable here) — a startup warning below says so.
  //
  // Host is validated on every request: rebinding works by making the
  // attacker's page same-origin with this server, and the Host header is
  // where that shows up. Origin is not validated here (SDK-aligned default);
  // set `allowedOrigins` on the MCPServer to opt in — the handler middleware
  // enforces it. Sandboxed view iframes have an opaque origin, so their
  // module/asset GETs legitimately carry `Origin: null` — and external hosts
  // rendering views through the tunnel fetch assets with their own origins.
  // Those cross-origin loads also need CORS: the MCP server's view asset/public
  // routes always emit `Access-Control-Allow-Origin: *`. Vite-served module
  // URLs (onRequest below) emit `*` while a tunnel is active; without a tunnel,
  // localhost binds reflect a validated loopback Origin (exact value +
  // `Vary: Origin`) so a local MCP host can load the module graph, while
  // foreign / opaque / missing Origin get no ACAO. Public/wildcard binds are
  // intentionally network-visible and emit `*`, matching a public tunnel.
  const rejectDisallowedRequest = (
    req: IncomingMessage,
    res: ServerResponse
  ): boolean => {
    const tunnelUrl = tunnelManager.status().url;
    const tunnelHost = tunnelUrl !== null ? new URL(tunnelUrl).hostname : null;
    const extra = tunnelHost !== null ? [tunnelHost] : [];
    const result = validateHostHeader(req.headers.host, [
      ...localhostAllowedHostnames(),
      ...extra,
    ]);
    if (result.ok) {
      return false;
    }
    // Same JSON-RPC 403 shape the SDK's own validation responses use.
    res.writeHead(403, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: result.message },
        id: null,
      })
    );
    return true;
  };

  /**
   * Tear down everything the running dev process owns, in dependency order:
   * watcher subscriptions, tunnel, HTTP listener, module runner, Vite.
   */
  const teardown = async (): Promise<void> => {
    if (skillsReloadTimer !== undefined) clearTimeout(skillsReloadTimer);
    if (viewsDiscoveryTimer !== undefined) clearTimeout(viewsDiscoveryTimer);
    vite.watcher.off("change", onSsrFileEvent);
    vite.watcher.off("add", onFileAddOrUnlink);
    vite.watcher.off("unlink", onFileAddOrUnlink);
    if (reloadTimer !== undefined) clearTimeout(reloadTimer);
    await tunnelManager.stop();
    // Stop accepting new connections first, then terminate the long-lived
    // transports that would otherwise keep the close callback pending:
    // closeAllConnections() ends active MCP subscription streams, while
    // vite.close() below owns upgraded HMR WebSockets.
    const httpClosed = new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (
          error !== undefined &&
          (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
        ) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    httpServer.closeAllConnections();
    await runner.close();
    await vite.close();
    await httpClosed;
  };

  const devFetch = createDevApiHandler(
    {
      getBasePath: () => basePath,
      port,
      tunnel: tunnelManager,
    },
    (request) => {
      if (
        inspectorHandler !== undefined &&
        isInspectorRequest(request, basePath)
      ) {
        return inspectorHandler(request);
      }
      return currentHandler(request);
    }
  );

  const projectRequire = createRequire(join(options.cwd, "package.json"));
  let nodeBridgeEntry: string;
  try {
    nodeBridgeEntry = projectRequire.resolve("mcp-use/node");
  } catch (error) {
    throw new Error(
      "Could not resolve mcp-use/node from the selected project. Install " +
        "mcp-use in the project before running mcp-use dev.",
      { cause: error }
    );
  }
  const { toNodeHandler } = (await import(
    pathToFileURL(nodeBridgeEntry).href
  )) as {
    toNodeHandler(handler: {
      fetch: WebHandler;
    }): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  };
  const nodeListener = toNodeHandler({ fetch: devFetch });

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (localhostBind && rejectDisallowedRequest(req, res)) {
      return;
    }
    const url = req.url ?? "/";
    const pathname = new URL(url, "http://127.0.0.1").pathname;
    const tunnelUrl = tunnelManager.status().url;
    const tunnelHostname =
      tunnelUrl === null ? null : new URL(tunnelUrl).hostname;
    const requestHostname = hostnameFromHostHeader(req.headers.host);
    if (
      ((tunnelHostname !== null && requestHostname === tunnelHostname) ||
        (wildcardBind &&
          requestHostname !== undefined &&
          !["localhost", "127.0.0.1", "::1"].includes(requestHostname))) &&
      isInspectorPath(pathname, basePath)
    ) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    // Routing to Vite requires both the client environment (configured only
    // when views existed at startup) and a currently non-empty registry.
    const viewsEnabled = viewsAtStartup && currentViews.length > 0;
    // Vite sees module-graph URLs (/@vite/client, /@id/virtual:…,
    // /.mcp-use/cache/deps/…, view files under /views/…) plus standard
    // node_modules pre-bundles; everything else — the MCP endpoint included —
    // goes straight to the fetch handler.
    const isViteRequest =
      req.method === "GET" &&
      (pathname.startsWith("/@") ||
        pathname.startsWith("/node_modules/") ||
        pathname.startsWith("/.mcp-use/") ||
        (viewsEnabled && pathname.startsWith("/views/")));

    if (viewsEnabled && isViteRequest) {
      // CORS for Vite module URLs: tunnel → `*`; else localhost bind with a
      // validated loopback Origin → reflect that origin (+ Vary). Foreign /
      // opaque / missing Origin stay without ACAO so the source module graph
      // is not readable to arbitrary websites.
      applyViteModuleCors(req, res, {
        tunnelActive: tunnelManager.status().url !== null,
        localhostBind,
      });
      const tunnelRequest =
        tunnelHostname !== null && requestHostname === tunnelHostname;
      // Vite performs its own static Host check after our dynamic validator.
      // Its allowlist cannot be updated when the tunnel starts at runtime, so
      // pass the already-validated active tunnel request through as localhost.
      // The same rewrite is applied to HMR upgrades above.
      if (tunnelRequest) {
        req.headers.host = `localhost:${port}`;
      }
      vite.middlewares(req, res, () => {
        void nodeListener(req, res);
      });
    } else {
      void nodeListener(req, res);
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
  console.log(`  ➜ MCP endpoint:  ${devClientEndpoint.origin}${basePath}`);
  if (inspectorHandler !== undefined) {
    console.log(
      `  ➜ Inspector:     ${devClientEndpoint.origin}${basePath}/inspector`
    );
  } else if (options.inspector !== false) {
    console.warn(
      "[mcp-use] Built-in Inspector is unavailable; reinstall mcp-use to " +
        "restore visual testing."
    );
  }
  if (host === "0.0.0.0" || host === "::") {
    const lan = lanAddress();
    if (lan !== undefined) {
      console.log(`  ➜ Network:       http://${lan}:${port}${basePath}`);
    }
  }
  if (!localhostBind) {
    console.warn(
      `[mcp-use] --host ${host} serves beyond this machine without Host ` +
        `validation or authentication — anyone with network access can call ` +
        `the MCP endpoint and dev routes.`
    );
  }

  if (options.tunnel === true) {
    try {
      const { url } = await tunnelManager.start(port);
      console.log(`  ➜ Tunnel:        ${url}${basePath}`);
    } catch (error) {
      await teardown();
      throw error;
    }
  }

  // Auto-open the inspector — unless disabled (`--no-open`) or stdout is not
  // a TTY (agents/CI: no browser to open, and no error to fail on).
  if (
    inspectorHandler !== undefined &&
    options.open !== false &&
    process.stdout.isTTY === true
  ) {
    openInBrowser(`${devClientEndpoint.origin}${basePath}/inspector`);
  }

  // --- Graceful shutdown (SIGINT/SIGTERM or options.signal). ---------------
  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      void (async () => {
        try {
          await teardown();
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          // Package managers may forward the terminal signal to their child
          // after the whole foreground process group already received it.
          // Keep swallowing duplicates until asynchronous teardown (notably
          // tunnel release) finishes, then restore the default signal action.
          process.off("SIGINT", shutdown);
          process.off("SIGTERM", shutdown);
        }
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
