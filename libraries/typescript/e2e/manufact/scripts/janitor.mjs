#!/usr/bin/env node
// Remove stale e2e deployments (PLAN.md §18.8.8 layer 2).
//
//   node e2e/manufact/scripts/janitor.mjs [--execute]
//
// Lists deployments of ev-e2e-app, selects `r<run>a<att>-` branches older than
// janitorMaxAgeMs and PR dev-space `pr<n>-` branches older than janitorPrMaxAgeMs
// (w* branches are exempt) and stops and removes them. Without
// --execute it only prints the selection.
import { execFileSync } from "node:child_process";
import { env, janitorSelect, parseArgs, readMatrix } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const matrix = readMatrix();
const cli = env("E2E_MCP_USE_CLI") ?? "mcp-use";
const mcpUse = (argv) =>
  execFileSync(cli, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

if (!env("MANUFACT_TOKEN")) {
  console.error("MANUFACT_TOKEN is required");
  process.exit(2);
}
const server = JSON.parse(
  mcpUse(["servers", "get", matrix.servers.app, "--json"])
);
const listed = JSON.parse(
  mcpUse(["deployments", "list", "--server", matrix.servers.app, "--json"])
);
const items = Array.isArray(listed)
  ? listed
  : (listed.items ?? listed.deployments ?? []);
const stale = janitorSelect(items, {
  serverId: server.id,
  now: Date.now(),
  maxAgeMs: matrix.janitorMaxAgeMs,
  prMaxAgeMs: matrix.janitorPrMaxAgeMs,
});
console.log(
  JSON.stringify(
    {
      execute: Boolean(args.execute),
      stale: stale.map((d) => ({
        id: d.id,
        branch: d.branch,
        createdAt: d.createdAt,
      })),
    },
    null,
    2
  )
);
if (args.execute) {
  for (const d of stale) {
    mcpUse(["deployments", "stop", d.id, "--yes"]);
    mcpUse(["deployments", "rm", d.id, "--yes"]);
  }
  // TODO(events): ev-e2e-tmp-* server cleanup needs `servers list --json` createdAt; add when MF5 lands.
}
