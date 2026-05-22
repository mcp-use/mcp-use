/**
 * Best-effort handshake file written after a server starts listening.
 *
 * The file lives at `.mcp-use/server-info.json` and lets out-of-process
 * tooling (CLI, inspector launcher) discover the running server's basePath
 * and constructed URLs without an HTTP discovery endpoint.
 *
 * Failures are swallowed — startup must never block on the file write.
 * Stale files are tolerated: next `listen()` overwrites them, and the cost
 * of a stale read is one 404 on auto-open.
 */

import { isDeno } from "./runtime.js";

export interface ServerInfoFile {
  host: string;
  port: number;
  basePath: string;
  mcpUrl: string;
  inspectorUrl: string;
  writtenAt: string;
}

/**
 * Write the server-info handshake file. Best-effort: swallows errors so
 * startup never blocks. Skipped on Deno (no filesystem write here).
 */
export async function writeServerInfoFile(info: {
  host: string;
  port: number;
  basePath: string;
}): Promise<void> {
  if (isDeno) return;

  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), ".mcp-use");
    await fs.mkdir(dir, { recursive: true });

    const browserHost = info.host === "0.0.0.0" ? "localhost" : info.host;
    const origin = `http://${browserHost}:${info.port}`;
    const payload: ServerInfoFile = {
      host: info.host,
      port: info.port,
      basePath: info.basePath,
      mcpUrl: `${origin}${info.basePath}/mcp`,
      inspectorUrl: `${origin}${info.basePath}/inspector`,
      writtenAt: new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(dir, "server-info.json"),
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  } catch {
    // swallow — never block startup on this
  }
}
