import { randomBytes } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BuildEnvironment,
  createRunnableDevEnvironment,
  defaultAllowedOrigins,
  isRunnableDevEnvironment,
  normalizePath,
  type Plugin,
  type PluginOption,
  type ResolvedConfig,
  type Rolldown,
  type ViteDevServer,
} from "vite";
import {
  buildDevViewsManifest,
  discoverViews,
  isViewEntryPath,
  mcpUseViewsPlugin,
  syncMcpEnvDeclaration,
  virtualViewId,
} from "@mcp-use/cli/internal/vite";
import {
  discoverConfiguredSkills,
  resolveConfiguredSkillsDirectory,
} from "@mcp-use/cli/internal/skills-loader";
import type { MCPServer } from "../server.js";
import { toNodeHandler } from "../node-bridge.js";
import { publicContentType } from "../views/public-route.js";
import type { EmbeddedViewAssets, ViewsManifest } from "../views/types.js";
import type { SkillsSnapshot } from "../skills/types.js";
import { createDevRuntime } from "./dev-runtime.js";

const HANDLER = "#mcp-use-vite-handler";
const VIRTUAL_HANDLER = "\0mcp-use:handler";
const ENTRY = "\0mcp-use:server";

/** Options shared by Vite framework integrations. */
export interface McpUseOptions {
  /** Server entry relative to the project root. Defaults to `src/mcp/server.ts`. */
  entry?: string;
  /** View source directory. Defaults to `src/mcp/views`. */
  viewsDir?: string;
  /** MCP endpoint; must match the authored server. Defaults to `/mcp`. */
  basePath?: string;
}

function within(file: string, directory: string): boolean {
  const path = relative(directory, file);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function publicAssets(directory: string): Promise<EmbeddedViewAssets> {
  const assets = Object.create(null) as EmbeddedViewAssets;
  async function visit(root: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) await visit(path, `${prefix}${entry.name}/`);
      else if (entry.isFile())
        assets[prefix + entry.name] = {
          body: (await readFile(path)).toString("base64"),
          contentType: publicContentType(entry.name),
        };
    }
  }
  await visit(directory, "public/");
  return assets;
}

/**
 * Run MCP in a dedicated Vite environment and serve live browser view modules.
 * Pair with a framework route adapter that imports the generated MCP handler.
 * The host supplies its React and CSS plugins. Production builds embed view
 * assets and skills into the MCP output and validate the compiled server using
 * the host's production configuration; runtime imports never load Vite.
 * @param options - Source directories and MCP endpoint.
 * @returns Plugins placed before the host framework plugins.
 */
export function mcpUse(options: McpUseOptions = {}): PluginOption[] {
  const configuredBasePath = options.basePath ?? "/mcp";
  let end = configuredBasePath.length;
  while (end > 0 && configuredBasePath[end - 1] === "/") end--;
  const basePath = configuredBasePath.slice(0, end);
  if (
    !basePath.startsWith("/") ||
    basePath.includes("//") ||
    /[:*?#\s]/.test(basePath)
  ) {
    throw new Error("mcpUse basePath must be a concrete absolute path.");
  }
  let config: ResolvedConfig;
  let root = process.cwd();
  let cors: NonNullable<import("vite").ServerOptions["cors"]> = false;
  let entry: string;
  let views: ReturnType<typeof discoverViews> = [];
  let devServer: ViteDevServer | undefined;
  let runtime: ReturnType<typeof createDevRuntime> | undefined;
  let skillsDirectory: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let manifest: ViewsManifest = {};
  let assets: EmbeddedViewAssets = {};
  let skills: SkillsSnapshot | undefined;
  const bridgePath = `/@mcp-use/${randomBytes(24).toString("hex")}`;
  const viewsPlugin = mcpUseViewsPlugin({
    getViews: () => views,
    tailwind: false,
    environments: ["client", "mcpViews"],
  });

  const report = (error: unknown) =>
    config.logger.error(
      `[mcp-use] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    );
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void runtime?.reload();
    }, 30);
  };

  async function prepare(server: MCPServer, dev: boolean): Promise<MCPServer> {
    try {
      if (!server || typeof server.__primeViews !== "function") {
        throw new Error(
          "The MCP entry must default-export an MCPServer instance."
        );
      }
      if (server.basePath !== basePath)
        throw new Error(
          `MCP basePath mismatch: server uses ${server.basePath}, plugin uses ${basePath}.`
        );
      const conventionalSkills = join(
        dirname(options.entry ?? "src/mcp/server.ts"),
        "skills"
      );
      skillsDirectory = resolveConfiguredSkillsDirectory(
        server.__skillsConfig(),
        config.root,
        conventionalSkills
      );
      if (dev && skillsDirectory) devServer!.watcher.add(skillsDirectory);
      skills = discoverConfiguredSkills(
        server.__skillsConfig(),
        config.root,
        conventionalSkills
      );
      server.__primeSkills(skills);
      const devManifest = buildDevViewsManifest(views);
      const base = config.base;
      if (base !== "/")
        for (const view of Object.values(devManifest)) {
          view.entry = base + view.entry.slice(1);
          view.scripts = view.scripts.map((path) => base + path.slice(1));
        }
      server.__primeViews(
        dev ? devManifest : manifest,
        dev ? { dev: true, projectRoot: config.root } : { assets }
      );
      server.__mount();
      return server;
    } catch (error) {
      if (typeof server?.close === "function")
        await server.close().catch(report);
      throw error;
    }
  }

  const plugin: Plugin = {
    name: "mcp-use",
    enforce: "pre",
    sharedDuringBuild: true,
    config(userConfig, env) {
      root = resolve(userConfig.root ?? process.cwd());
      cors = userConfig.server?.cors ?? {
        origin: [defaultAllowedOrigins, "null"],
      };
      if (userConfig.environments?.mcp || userConfig.environments?.mcpViews)
        throw new Error("The mcp Vite environment is reserved by mcp-use.");
      if (env.command === "serve")
        Object.assign(
          viewsPlugin,
          mcpUseViewsPlugin({
            getViews: () => views,
            tailwind: false,
            dev: { reactRefresh: true },
          })
        );
      return {
        environments: {
          mcp: { consumer: "server" },
          ...(env.command === "build" && {
            mcpViews: { consumer: "client" as const },
          }),
        },
        builder: { sharedConfigBuild: true },
        server: { cors },
        resolve: { noExternal: ["mcp-use"] },
      };
    },
    async configResolved(resolved) {
      config = resolved;
      // Nitro disables Vite CORS; opaque-origin view modules need the host
      // policy (or the localhost/null default) restored before middleware setup.
      config.server.cors = cors;
      entry = normalizePath(
        resolve(config.root, options.entry ?? "src/mcp/server.ts")
      );
      views = discoverViews(config.root, options.viewsDir ?? "src/mcp/views");
      await syncMcpEnvDeclaration(config.root, entry);
    },
    // Configure inputs after framework config hooks, so Start's entries survive
    // and Nitro does not register the private MCP entry as its own service.
    configEnvironment: {
      order: "post",
      handler(name, _environment, env) {
        if (name === "mcp")
          return {
            consumer: "server",
            dev: {
              createEnvironment: (name, resolved) =>
                createRunnableDevEnvironment(name, resolved, { hot: false }),
            },
            build: {
              outDir: ".mcp-use/vite/mcp",
              emptyOutDir: true,
              copyPublicDir: false,
              ssr: true,
              rollupOptions: {
                input: ENTRY,
                output: { entryFileNames: "server.mjs" },
              },
            },
          };
        if (name === "mcpViews" && env.command === "build") {
          const discovered = discoverViews(
            root,
            options.viewsDir ?? "src/mcp/views"
          );
          return {
            build: {
              createEnvironment: (name, resolved) =>
                new BuildEnvironment(name, {
                  ...resolved,
                  base: "./",
                }),
              outDir: ".mcp-use/vite/views",
              emptyOutDir: true,
              copyPublicDir: false,
              rollupOptions: {
                input: discovered.length
                  ? Object.fromEntries(
                      discovered.map((view) => [
                        `mcp-${view.name}`,
                        virtualViewId(view.name),
                      ])
                    )
                  : "\0mcp-use:empty-views",
              },
            },
          };
        }
      },
    },
    async configureServer(server) {
      devServer = server;
      // Framework middleware can replace Vite's Vary header (Nitro currently
      // does). Preserve Origin so immutable optimized modules cached by the
      // website aren't reused with the wrong CORS headers in an opaque iframe.
      if (cors !== false)
        server.middlewares.use((_req, res, next) => {
          const setHeader = res.setHeader;
          res.setHeader = function (name, value) {
            if (name.toLowerCase() === "vary") {
              const fields = String(value)
                .split(",")
                .map((field) => field.trim());
              if (
                !fields.some(
                  (field) => field === "*" || field.toLowerCase() === "origin"
                )
              ) {
                value = [...fields, "Origin"].join(", ");
              }
            }
            return setHeader.call(this, name, value);
          };
          res.setHeader("Vary", "Origin");
          next();
        });
      const environment = server.environments.mcp!;
      if (!isRunnableDevEnvironment(environment))
        throw new Error("MCP requires a runnable Node Vite environment.");
      runtime = createDevRuntime(async () => {
        views = discoverViews(config.root, options.viewsDir ?? "src/mcp/views");
        environment.runner.evaluatedModules.clear();
        const module = await environment.runner.import<{ default: MCPServer }>(
          entry
        );
        return prepare(module.default, true);
      }, report);
      // Start/Nitro may execute routes in a worker. This private same-listener
      // bridge preserves streaming and cancellation across that runtime boundary.
      const handle = toNodeHandler(
        {
          fetch: async (request) => {
            const original = request.headers.get("x-mcp-use-url");
            if (!original)
              return new Response("Missing original URL", { status: 400 });
            const headers = new Headers(request.headers);
            headers.delete("x-mcp-use-url");
            headers.delete("host");
            return runtime!.fetch(
              new Request(original, {
                method: request.method,
                headers,
                ...(request.body && { body: request.body, duplex: "half" }),
                signal: request.signal,
              })
            );
          },
        },
        { onerror: report }
      );
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== bridgePath) return next();
        void handle(req, res).catch(next);
      });
      const onDiscovery = (file: string) => {
        if (
          isViewEntryPath(
            file,
            config.root,
            options.viewsDir ?? "src/mcp/views"
          ) ||
          (skillsDirectory && within(file, skillsDirectory))
        )
          schedule();
      };
      const onChange = (file: string) => {
        if (skillsDirectory && within(file, skillsDirectory)) schedule();
      };
      server.watcher
        .on("add", onDiscovery)
        .on("unlink", onDiscovery)
        .on("addDir", onDiscovery)
        .on("unlinkDir", onDiscovery)
        .on("change", onChange);
      const close = server.close.bind(server);
      server.close = async () => {
        clearTimeout(timer);
        server.watcher
          .off("add", onDiscovery)
          .off("unlink", onDiscovery)
          .off("addDir", onDiscovery)
          .off("unlinkDir", onDiscovery)
          .off("change", onChange);
        await runtime!.close();
        await close();
      };
      await runtime.reload();
    },
    hotUpdate({ modules, timestamp }) {
      if (this.environment.name !== "mcp") return;
      if (modules.length) {
        const invalidated = new Set<import("vite").EnvironmentModuleNode>();
        for (const module of modules)
          this.environment.moduleGraph.invalidateModule(
            module,
            invalidated,
            timestamp,
            true
          );
        schedule();
      }
      // MCP reloads must not cause Nitro to reload the browser document.
      return [];
    },
    resolveId(id) {
      if (id === "\0mcp-use:empty-views") return id;
      if (id === HANDLER) return VIRTUAL_HANDLER;
      if (id === ENTRY) return ENTRY;
    },
    load(id) {
      if (id === "\0mcp-use:empty-views") return "export {};";
      if (id !== VIRTUAL_HANDLER && id !== ENTRY) return;
      if (this.environment.config.consumer !== "server")
        throw new Error(
          "The MCP handler must only be imported by a server route."
        );
      if (id === ENTRY)
        return `export { default } from ${JSON.stringify(entry)};`;
      if (!devServer)
        return `export { handleMcpRequest } from ${JSON.stringify(normalizePath(resolve(config.root, ".mcp-use/vite/mcp/index.js")))};`;
      const address = devServer.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error(
          "MCP development forwarding requires Vite's HTTP listener."
        );
      const host =
        address.address === "::"
          ? "[::1]"
          : address.address === "0.0.0.0"
            ? "127.0.0.1"
            : address.family === "IPv6"
              ? `[${address.address}]`
              : address.address;
      const url = `${config.server.https ? "https" : "http"}://${host}:${address.port}${bridgePath}`;
      return `export async function handleMcpRequest(request) {
        const headers = new Headers(request.headers);
        headers.set("x-mcp-use-url", request.url);
        headers.delete("host");
        return fetch(${JSON.stringify(url)}, { method: request.method, headers,
          body: request.body, duplex: "half", signal: request.signal, redirect: "manual" });
      }`;
    },
    // Capture after all generateBundle hooks have finalized preload URLs, CSS
    // and dynamic imports. Earlier snapshots can contain Vite placeholders.
    writeBundle(_options, bundle) {
      if (this.environment.name !== "mcpViews") return;
      manifest = {};
      const embedded = Object.create(null) as EmbeddedViewAssets;
      assets = embedded;
      for (const view of views) {
        const chunk = Object.values(bundle).find(
          (output): output is Rolldown.OutputChunk =>
            output.type === "chunk" &&
            output.facadeModuleId === `\0${virtualViewId(view.name)}`
        );
        if (!chunk) throw new Error(`Missing compiled MCP view ${view.name}`);
        const css = new Set<string>();
        const visited = new Set<string>();
        const visit = (file: string) => {
          if (visited.has(file)) return;
          visited.add(file);
          const output = bundle[file];
          if (!output) return;
          embedded[`${view.name}/${file}`] = {
            body: Buffer.from(
              output.type === "chunk" ? output.code : output.source
            ).toString("base64"),
            contentType: publicContentType(file),
          };
          if (output.type === "chunk") {
            for (const imported of [
              ...output.imports,
              ...output.dynamicImports,
            ])
              visit(imported);
            const metadata = (
              output as Rolldown.OutputChunk & {
                viteMetadata?: {
                  importedCss: Set<string>;
                  importedAssets: Set<string>;
                };
              }
            ).viteMetadata;
            for (const file of metadata?.importedCss ?? []) {
              css.add(file);
              visit(file);
            }
            for (const file of metadata?.importedAssets ?? []) visit(file);
          }
        };
        visit(chunk.fileName);
        // CSS url() dependencies are output assets rather than JS imports.
        for (const output of Object.values(bundle))
          if (output.type === "asset") visit(output.fileName);
        manifest[view.name] = {
          kind: "external",
          entry: chunk.fileName,
          css: [...css],
        };
      }
    },
    async buildApp(builder) {
      const client = builder.environments.mcpViews!;
      if (!client.isBuilt) await builder.build(client);
      if (config.publicDir)
        Object.assign(assets, await publicAssets(config.publicDir));
      // Validate the actual production module, including host build plugins,
      // defines and mode-specific env values. A second dev server cannot
      // reproduce the MCP build environment's transforms or resolution.
      const mcp = builder.environments.mcp!;
      if (!mcp.isBuilt) await builder.build(mcp);
      const outputDirectory = resolve(config.root, mcp.config.build.outDir);
      const compiledEntry = pathToFileURL(join(outputDirectory, "server.mjs"));
      compiledEntry.searchParams.set(
        "validation",
        randomBytes(12).toString("hex")
      );
      let candidate: MCPServer | undefined;
      try {
        const compiled = (await import(
          /* @vite-ignore */ compiledEntry.href
        )) as {
          default: MCPServer;
        };
        candidate = await prepare(compiled.default, false);
      } finally {
        await candidate?.close();
      }
      // Snapshot discovery needs a live server, so add the runtime wrapper
      // only after validation. Downstream framework builds consume this entry
      // and the same compiled server; the authored code is compiled just once.
      await writeFile(
        join(outputDirectory, "index.js"),
        `import server from "./server.mjs";
server.__primeViews(${JSON.stringify(manifest)}, {assets:${JSON.stringify(assets)}});
server.__primeSkills(${JSON.stringify(skills)});
export const handleMcpRequest = request => server.fetch(request);
`
      );
    },
  };
  return [plugin, viewsPlugin];
}
