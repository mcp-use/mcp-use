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
  /** MCP endpoint matching MCPServer.basePath. Defaults to `/mcp`. */
  basePath?: string;
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
    "--no-views-config",
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
 * build runs once when the server imports the MCP handler, including development.
 * Restart Vite after changing MCP views or skills. Generated files are embedded in the server
 * bundle, so the deployed app does not read the source checkout at runtime.
 * Views use built-in React, Tailwind and tsconfig alias support; the application's
 * Vite config and custom plugins are not loaded by the view build.
 *
 * @param options - MCP source and route configuration.
 * @returns Vite plugin placed before TanStack Start and React plugins.
 */
export function mcpUseTanStackStart(
  options: TanStackStartOptions = {}
): Plugin {
  if (process.env[BUILD_GUARD] === "1") {
    throw new Error(
      "The MCP view build must not load mcpUseTanStackStart(). Disable project Vite config discovery with --no-views-config."
    );
  }
  const configuredBasePath = options.basePath ?? "/mcp";
  let end = configuredBasePath.length;
  while (end > 0 && configuredBasePath[end - 1] === "/") end--;
  const basePath = configuredBasePath.slice(0, end);
  if (
    !basePath.startsWith("/") ||
    basePath === "" ||
    basePath.includes("//") ||
    /[:*?#\s]/.test(basePath)
  ) {
    throw new Error(
      "mcpUseTanStackStart basePath must be a concrete absolute path."
    );
  }
  let root: string | undefined;
  let build: Promise<TanStackStartBuild> | undefined;
  return {
    name: "mcp-use-tanstack-start",
    enforce: "pre",
    config() {
      // Process the private build import instead of leaving it to Node.
      return { ssr: { noExternal: ["mcp-use"] } };
    },
    configResolved(config) {
      root = resolve(config.root);
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
      if (root === undefined)
        throw new Error("TanStack Start MCP build has not initialized.");
      build ??= buildTanStackStartMcp(root, options, basePath);
      const serializedBuild = JSON.stringify(await build);
      return `export async function loadTanStackStartBuild() { return JSON.parse(${JSON.stringify(serializedBuild)}); }`;
    },
  };
}
