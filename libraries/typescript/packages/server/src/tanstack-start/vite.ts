import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

import { publicContentType } from "../views/public-route.js";
import type { TanStackStartBuild } from "./types.js";

const BUILD_IMPORT = "#mcp-use-tanstack-start-build";
const VIRTUAL_BUILD = "\0mcp-use:tanstack-start-build";
const BUILD_GUARD = "MCP_USE_TANSTACK_START_BUILD";

/** Options for the TanStack Start Vite integration. */
export interface TanStackStartOptions {
  /** Server entry relative to the Vite project root. Defaults to `src/mcp/server.ts`. */
  entry?: string;
  /** Views directory relative to the Vite project root. Defaults to `src/mcp/views`. */
  viewsDir?: string;
  /** MCP endpoint matching MCPServer.basePath. Defaults to `/api/mcp`. */
  basePath?: string;
  /**
   * Separate Vite config for browser views, relative to the project root.
   * The Start app's config is never loaded by the view build by default.
   * React, Tailwind and tsconfig aliases are supported without a custom config.
   * Do not include Start, deployment or this integration's plugins here.
   */
  viewsConfig?: string;
}

async function readAssets(
  directory: string
): Promise<TanStackStartBuild["assets"]> {
  const assets = Object.create(null) as TanStackStartBuild["assets"];
  const visit = async (root: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(root, entry.name);
      const key = prefix + entry.name;
      if (entry.isDirectory()) await visit(path, `${key}/`);
      else if (entry.isFile()) {
        assets[key] = {
          body: (await readFile(path)).toString("base64"),
          contentType: publicContentType(entry.name),
        };
      }
    }
  };
  await visit(directory, "");
  return assets;
}

async function buildTanStackStartMcp(
  root: string,
  options: TanStackStartOptions,
  basePath: string
): Promise<TanStackStartBuild> {
  const cli = fileURLToPath(new URL("../bin.js", import.meta.url));
  const args = [
    cli,
    "build",
    "--entry",
    options.entry ?? "src/mcp/server.ts",
    "--mcp-dir",
    dirname(options.entry ?? "src/mcp/server.ts"),
    "--views-dir",
    options.viewsDir ?? "src/mcp/views",
    ...(options.viewsConfig === undefined
      ? ["--no-views-config"]
      : ["--views-config", options.viewsConfig]),
  ];
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, [BUILD_GUARD]: "1" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveBuild();
      else
        reject(
          new Error(`TanStack Start MCP build failed (${signal ?? code}).`)
        );
    });
  });
  const directory = join(root, ".mcp-use", "build");
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8")
  ) as Pick<TanStackStartBuild, "views" | "skills">;
  return {
    basePath,
    views: manifest.views,
    ...(manifest.skills !== undefined && { skills: manifest.skills }),
    assets: await readAssets(join(directory, "views")),
  };
}

/**
 * Build and bundle an MCP server's views, public assets and skills for Start.
 *
 * Supports TanStack React Start with Vite and a Node deployment. The MCP
 * build runs once when Vite starts, including development. Restart Vite after
 * changing MCP views or skills. Generated files are embedded in the server
 * bundle, so the deployed app does not read the source checkout at runtime.
 *
 * @param options - MCP source and route configuration.
 * @returns Vite plugin placed before TanStack Start and React plugins.
 */
export function mcpUseTanStackStart(
  options: TanStackStartOptions = {}
): Plugin {
  if (process.env[BUILD_GUARD] === "1") {
    throw new Error(
      "The MCP views config must not include mcpUseTanStackStart(). Use a separate viewsConfig."
    );
  }
  const basePath = (options.basePath ?? "/api/mcp").replace(/\/+$/, "");
  if (!basePath.startsWith("/") || basePath === "" || /[:*?#]/.test(basePath)) {
    throw new Error(
      "mcpUseTanStackStart basePath must be a concrete absolute path."
    );
  }
  let build: Promise<TanStackStartBuild> | undefined;
  return {
    name: "mcp-use-tanstack-start",
    enforce: "pre",
    config() {
      // Process the private build import instead of leaving it to Node.
      return { ssr: { noExternal: ["mcp-use"] } };
    },
    async configResolved(config) {
      build ??= buildTanStackStartMcp(resolve(config.root), options, basePath);
      await build;
    },
    resolveId(id) {
      if (id === BUILD_IMPORT) return VIRTUAL_BUILD;
    },
    async load(id) {
      if (id !== VIRTUAL_BUILD) return;
      if (this.environment.config.consumer !== "server") {
        throw new Error(
          "mcp-use/tanstack-start must only be imported by a server route."
        );
      }
      if (build === undefined)
        throw new Error("TanStack Start MCP build has not initialized.");
      return `export async function loadTanStackStartBuild() { return ${JSON.stringify(await build)}; }`;
    },
  };
}
