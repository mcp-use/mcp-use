/**
 * Inline implementation of `mcp-use start` (specs/CLI_SPEC.md).
 *
 * Serves a production build from `.mcp-use/build/` with zero toolchain
 * dependencies: read the manifest, import the built entry, call `listen()`
 * on its default-exported server.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolvePort } from "./args.js";
import { loadProjectEnv } from "../cli/next-compat.js";

/*
 * Workspace constants, re-declared per CLI_SPEC.md ("Same names,
 * re-declared") — never imported from the old `mcp-use` package.
 */
const WORKSPACE_DIR_NAME = ".mcp-use";
const BUILD_SUBDIR_NAME = "build";
const BUILD_MANIFEST_NAME = "manifest.json";

/**
 * The duck-typed contract `start` needs from the built entry's default
 * export — satisfied by an `MCPServer` instance. Checked at runtime, not by
 * an `instanceof`, so a build made against a different copy of the package
 * still starts.
 */
interface ListenableServer {
  listen(port?: number): Promise<unknown>;
  close?(): unknown;
}

/**
 * Options for {@link runStart}.
 *
 * @internal
 */
export interface StartOptions {
  /** Project root containing the `.mcp-use/` workspace. */
  cwd: string;
  /** Port from the `--port`/`-p` flag; falls back to `PORT` env, then 3000. */
  port?: number | undefined;
}

/**
 * Handle to a server started by {@link runStart}.
 *
 * @internal
 */
export interface StartedServer {
  /** Port the server reported it bound. */
  port: number;
  /** URL of the MCP endpoint, as reported by the server's `listen()`. */
  url: string;
  /** Stop the server (delegates to the instance's `close()`, if present). */
  close(): Promise<void>;
}

/**
 * Run `mcp-use start`: serve the production build under
 * `<cwd>/.mcp-use/build/`.
 *
 * Reads the build manifest, sets `NODE_ENV=production` (only if unset),
 * imports the built entry, and calls `listen()` on its default export.
 *
 * @param options - Project root and optional port override.
 * @throws Error with an actionable message when the manifest is missing
 * (pointing at `mcp-use build`), malformed, or the entry's default export is
 * not a server.
 *
 * @internal
 */
export async function runStart(options: StartOptions): Promise<StartedServer> {
  const buildDir = join(options.cwd, WORKSPACE_DIR_NAME, BUILD_SUBDIR_NAME);
  const manifestPath = join(buildDir, BUILD_MANIFEST_NAME);

  let rawManifest: string;
  try {
    rawManifest = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error(
      `No production build found (missing ${manifestPath}).\n` +
        `Run \`mcp-use build\` first, then \`mcp-use start\`.`
    );
  }

  let entryPoint: string;
  try {
    const manifest = JSON.parse(rawManifest) as { entryPoint?: unknown };
    if (typeof manifest.entryPoint !== "string" || manifest.entryPoint === "") {
      throw new Error("missing entryPoint");
    }
    entryPoint = manifest.entryPoint;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid build manifest at ${manifestPath} (${reason}).\n` +
        `Re-run \`mcp-use build\`.`
    );
  }

  // Production posture, but never clobber an explicit NODE_ENV.
  process.env.NODE_ENV ??= "production";
  loadProjectEnv(options.cwd, "production");

  const entryPath = join(buildDir, entryPoint);
  const entryUrl = pathToFileURL(entryPath).href;
  const entryModule = (await import(entryUrl)) as { default?: unknown };

  if (!("default" in entryModule) || entryModule.default === undefined) {
    throw new Error(
      `The built entry (${entryPath}) has no default export.\n` +
        `The server entry must \`export default\` its MCPServer instance ` +
        `(see the mcp-use entry contract).`
    );
  }
  const candidate = entryModule.default;
  if (!isListenable(candidate)) {
    throw new Error(
      `The default export of ${entryPath} is not an MCPServer: it has no ` +
        `listen() method. Export the MCPServer instance as the default export.`
    );
  }

  const port = resolvePort(options.port);
  const result = (await candidate.listen(port)) as
    | { port?: unknown; url?: unknown }
    | undefined;
  const boundPort = typeof result?.port === "number" ? result.port : port;
  const url =
    typeof result?.url === "string"
      ? result.url
      : `http://localhost:${boundPort}`;

  return {
    port: boundPort,
    url,
    close: async () => {
      await candidate.close?.();
    },
  };
}

/** Duck-check that a value looks like a server we can `listen()` on. */
function isListenable(value: unknown): value is ListenableServer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { listen?: unknown }).listen === "function"
  );
}
