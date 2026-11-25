// The deployed E2E fixture app (PLAN.md §18.8.3). stage-fixture.mjs copies this
// directory next to vendor/*.tgz, combo.json and omit.json; it is never built
// inside the workspace.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { MCPServer } from "mcp-use";
import { z } from "zod";

const readJson = <T>(file: string, fallback: T): T => {
  try {
    // `mcp-use start` runs from the app root; the built entry lives under dist/.
    return JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as T;
  } catch {
    return fallback;
  }
};

const combo = readJson<Record<string, unknown>>("combo.json", {});
const omit = new Set(readJson<string[]>("omit.json", []));
const instance = `${hostname()}:${randomUUID()}`;
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ instance, msg, ...extra }));

const server = new MCPServer({
  name: "ev-e2e-fixture",
  version: "1.0.0",
  description: "MCP Events E2E fixture for the Manufact dev space.",
});

// The pass-through headers seen on the most recent tools/call (E1). Calls in
// the harness are sequential per connection.
const PASS_THROUGH = [
  "mcp-name",
  "mcp-method",
  "mcp-protocol-version",
  "user-agent",
];
let lastHeaders: Record<string, string> = {};
server.on("mcp:tools/call", (ctx) => {
  const seen: Record<string, string> = {};
  for (const name of PASS_THROUGH) {
    const v = ctx.request?.header(name);
    if (v !== undefined) seen[name] = v;
  }
  for (const [name, value] of Object.entries(ctx.request?.header() ?? {})) {
    if (name.toLowerCase().startsWith("mcp-param-"))
      seen[name.toLowerCase()] = String(value);
  }
  lastHeaders = seen;
});

server.tool(
  {
    name: "echo-request",
    description: "Return the pass-through headers this call carried.",
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(lastHeaders) }],
  })
);

server.tool(
  {
    name: "combo",
    description: "Return combo.json and the runtime identity (R3b).",
  },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ combo, instance, omit: [...omit] }),
      },
    ],
  })
);

server.tool(
  {
    name: "log-marker",
    description:
      "Log a marker, then throw an error carrying a second marker (E14).",
    inputSchema: z.object({ marker: z.string(), errorMarker: z.string() }),
  },
  async ({ marker, errorMarker }) => {
    log("marker", { marker });
    throw new Error(`log-marker failure ${errorMarker}`);
  }
);

// TODO(events): define note.created, ticker, note.deleted (unless omitted),
// hooked and scoped with the server Events API (WP-23) and the `emit-note` tool
// once the API merges into feat/mcp-events; the R3b fields (build.sha,
// sdk.bundled, sdk.bundledHash, sdk.external, sdk.patchedPredicate) come from
// the health route (WP-26).

log("startup", { combo: combo.sha ?? null });

export default server;
