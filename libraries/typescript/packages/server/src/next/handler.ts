import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { MCPServer } from "../server.js";
import type { ViewManifestEntry, ViewsManifest } from "../views/types.js";

/** Route Handler exports returned by {@link createNextHandler}. */
export interface NextMcpHandlers {
  /** Handles MCP GET requests. */
  GET(request: Request): Promise<Response>;
  /** Handles MCP POST requests. */
  POST(request: Request): Promise<Response>;
  /** Handles MCP DELETE requests. */
  DELETE(request: Request): Promise<Response>;
  /** Handles CORS preflight requests. */
  OPTIONS(request: Request): Promise<Response>;
}

function isViewManifestEntry(value: unknown): value is ViewManifestEntry {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  if (value.kind === "inline") {
    return (
      "js" in value &&
      typeof value.js === "string" &&
      "css" in value &&
      typeof value.css === "string"
    );
  }
  return (
    value.kind === "external" &&
    "entry" in value &&
    typeof value.entry === "string" &&
    "css" in value &&
    Array.isArray(value.css) &&
    value.css.every((item) => typeof item === "string") &&
    (!("scripts" in value) ||
      (Array.isArray(value.scripts) &&
        value.scripts.every((item) => typeof item === "string")))
  );
}

function parseBuildManifest(raw: string, manifestPath: string): ViewsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid mcp-use build manifest at ${manifestPath}: ${reason}`
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("views" in parsed) ||
    typeof parsed.views !== "object" ||
    parsed.views === null ||
    Array.isArray(parsed.views) ||
    !Object.values(parsed.views).every(isViewManifestEntry)
  ) {
    throw new Error(`Invalid mcp-use build manifest at ${manifestPath}.`);
  }
  return parsed.views as ViewsManifest;
}

/**
 * Create App Router method exports for an authored MCP server.
 *
 * The generated artifact contains only view registration data; application
 * source continues to import its own server module. Initialization is lazy so
 * importing a route during `next build` does not perform filesystem I/O.
 *
 * @typeParam TUser - Authenticated application user type.
 * @param server - MCP server mounted by the route.
 * @returns App Router method exports for the MCP endpoint.
 *
 * @example
 * ```ts
 * import { server } from "@/mcp/server";
 * import { createNextHandler } from "mcp-use/next";
 *
 * export const { GET, POST, DELETE, OPTIONS } = createNextHandler(server);
 * ```
 */
export function createNextHandler<TUser>(
  server: MCPServer<TUser>
): NextMcpHandlers {
  const projectRoot = process.cwd();
  const manifestPath = join(
    process.cwd(),
    ".mcp-use",
    "build",
    "manifest.json"
  );

  let handlerPromise:
    | Promise<(request: Request) => Promise<Response>>
    | undefined;

  const initialize = async (): Promise<
    (request: Request) => Promise<Response>
  > => {
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "ENOENT") {
        throw new Error(
          `No mcp-use build found at ${manifestPath}. ` +
            "Wrap next.config with withMcpUse() before mounting this route."
        );
      }
      throw error;
    }
    server.__primeViews(parseBuildManifest(raw, manifestPath), {
      projectRoot,
    });
    return async (request) => server.fetch(request);
  };

  const handle = async (request: Request): Promise<Response> => {
    handlerPromise ??= initialize();
    return (await handlerPromise)(request);
  };

  const preflight = async (): Promise<Response> =>
    new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
        "Access-Control-Expose-Headers": "Mcp-Session-Id",
      },
    });

  return { GET: handle, POST: handle, DELETE: handle, OPTIONS: preflight };
}
