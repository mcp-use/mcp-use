/**
 * Vercel Function entry point. Files under `api/` on the Node.js runtime are
 * served at a matching `/api/*` path with zero extra config, as long as they
 * export a web-standard `fetch` handler — which `MCPServer` exposes directly.
 * No adapter layer needed.
 *
 * This file lives at `api/mcp.ts`, so Vercel serves it at `/api/mcp` — matching
 * `basePath: "/api/mcp"` set on the server in `mcp-server.ts`.
 *
 * The relative import uses a literal `.ts` extension (not the compiled-`.js`
 * convention `mcp-use`'s own source uses) because this example ships
 * unbuilt: `smoke.ts` runs it via Node's native TypeScript support, which
 * resolves imports by their real file extension, and Vercel's Node builder
 * (esbuild) resolves it the same way at deploy time.
 */
import { server } from "../mcp-server.ts";

export default server;
