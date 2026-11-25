#!/usr/bin/env node
// Subscription-continuity driver (PLAN.md D86, §18.7.3, WP-38).
//
//   node scripts/sdk-matrix/continuity.mjs --a <packs-dir> --b <packs-dir> --leg <leg>
//
// <packs-dir> holds the `pnpm pack` tarballs of one leg build (mcp-use,
// @mcp-use/client, @mcp-use/cli) as uploaded by events-sdk-matrix.yml. A is
// the `pinned` build, B the leg. When A's directory is empty (a nightly run of
// a single leg), the pinned build is made here in a throwaway git worktree via
// apply.mjs, never in the developer's checkout.
//
// Runs S/tests/continuity/sdk-continuity.test.ts twice: A -> B -> A, then
// B -> A -> B. The test installs examples/mcp-events from each set of tarballs
// and drives both servers against MCP_USE_TEST_REDIS_URL.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEST = "tests/continuity/sdk-continuity.test.ts";
const SERVER = join(ROOT, "packages", "server");

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`unexpected argument ${k}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--"))
      throw new Error(`${k} needs a value`);
    out[k.slice(2)] = v;
    i++;
  }
  for (const req of ["a", "b", "leg"])
    if (!out[req]) throw new Error(`missing --${req}`);
  return out;
}

export function tarballs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => join(dir, f))
    .sort();
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
}

function buildPinned(into) {
  const scratch = mkdtempSync(join(tmpdir(), "mcp-use-pinned-"));
  const repo = resolve(ROOT, "..", "..");
  run("git", ["worktree", "add", "--detach", scratch, "HEAD"], { cwd: repo });
  try {
    const lt = join(scratch, "libraries", "typescript");
    run("node", ["scripts/sdk-matrix/apply.mjs", "pinned", "--scratch"], {
      cwd: lt,
    });
    mkdirSync(into, { recursive: true });
    run(
      "pnpm",
      [
        "--filter",
        "mcp-use",
        "--filter",
        "@mcp-use/client",
        "--filter",
        "@mcp-use/cli",
        "pack",
        "--pack-destination",
        into,
      ],
      { cwd: lt }
    );
  } finally {
    run("git", ["worktree", "remove", "--force", scratch], { cwd: repo });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.leg === "pinned") {
    console.log("continuity: leg is pinned, A and B are the same build; skip");
    return 0;
  }
  let a = tarballs(args.a);
  const b = tarballs(args.b);
  if (!b.length) {
    console.error(
      `continuity: no tarballs for leg ${args.leg} in ${args.b} (the leg build failed or was skipped)`
    );
    return args.leg === "prerelease" ? 0 : 1;
  }
  if (!a.length) {
    buildPinned(args.a);
    a = tarballs(args.a);
  }
  if (!existsSync(join(SERVER, TEST))) {
    // TODO(events): the test lands with the Events engine (WP-23/WP-38).
    console.warn(`::warning::continuity: ${TEST} not present yet`);
    return 0;
  }
  if (process.env.CI === "true" && !process.env.MCP_USE_TEST_REDIS_URL) {
    console.error("continuity: MCP_USE_TEST_REDIS_URL is required in CI");
    return 1;
  }
  const directions = [
    { from: "pinned", to: args.leg, A: args.a, B: args.b },
    { from: args.leg, to: "pinned", A: args.b, B: args.a },
  ];
  for (const d of directions) {
    console.log(`continuity: ${d.from} -> ${d.to} -> ${d.from}`);
    run("pnpm", ["exec", "vitest", "run", TEST], {
      cwd: SERVER,
      env: {
        ...process.env,
        MCP_USE_CONTINUITY_A_PACKS: resolve(d.A),
        MCP_USE_CONTINUITY_B_PACKS: resolve(d.B),
        MCP_USE_CONTINUITY_A_LEG: d.from,
        MCP_USE_CONTINUITY_B_LEG: d.to,
      },
    });
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
