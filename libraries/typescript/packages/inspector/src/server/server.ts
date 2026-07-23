import { serve } from "@hono/node-server";
import open from "open";
import { createDevApiApp } from "./create-dev-api-app.js";
import { isPortAvailable, parsePortFromArgs, hasNoOpenFlag } from "./utils.js";

const isDev =
  process.env.NODE_ENV === "development" || process.env.VITE_DEV === "true";

/**
 * Standalone inspector API server (proxy + OAuth BFF).
 *
 * Normal local dev uses {@link ../vite-dev-api-plugin.ts} on the same port as
 * Vite. This entrypoint remains for `dev:server` / direct `tsx` runs.
 */
async function startServer() {
  try {
    const cliPort = parsePortFromArgs();
    const port =
      cliPort ??
      (Number(process.env.INSPECTOR_API_PORT) || (isDev ? 3001 : 3000));
    const available = await isPortAvailable(port);

    if (!available) {
      console.error(
        `❌ Port ${port} is not available. Please stop the process using this port and try again.`
      );
      process.exit(1);
    }

    const app = createDevApiApp();

    serve({
      fetch: app.fetch,
      port,
    });

    if (isDev) {
      console.warn(
        `🚀 MCP Inspector API server running on http://localhost:${port}`
      );
      console.warn(
        `💡 Tip: run \`pnpm dev\` to serve UI + API on one port via Vite.`
      );
    } else {
      console.warn("MCP Inspector started.");
    }

    if (process.env.NODE_ENV !== "production" && !hasNoOpenFlag()) {
      const url = `http://localhost:${port}`;
      try {
        await open(url);
        console.warn("Browser opened automatically.");
      } catch {
        console.warn("Browser could not be opened automatically.");
      }
    }

    return { port, fetch: app.fetch };
  } catch {
    console.error("Failed to start server (StartupError).");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export default { startServer };
