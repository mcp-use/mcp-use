#!/usr/bin/env node
// Stage the deployable fixture app from one variant bundle (PLAN.md §18.8.1 steps 5-6).
//
//   node e2e/manufact/scripts/stage-fixture.mjs --bundle <dir> --out <dir>
//        [--omit note.deleted,...] [--no-lock]
//
// <bundle> is the --out of build-variant.mjs (vendor/*.tgz, combo.json,
// sdk-variant.json) or of resolve-published.mjs (combo.json with mcpUse.specs,
// no vendor/). Writes <out>/{package.json,src/,vendor/?,combo.json,omit.json},
// runs `npm install --package-lock-only`, then the R3a lockfile check. Exit 1
// with class `product` when R3a fails.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  HARNESS_ROOT,
  checkLockfile,
  fixtureManifest,
  parseArgs,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (typeof args.bundle !== "string" || typeof args.out !== "string") {
  console.error(
    "usage: stage-fixture.mjs --bundle <dir> --out <dir> [--omit a,b] [--no-lock]"
  );
  process.exit(2);
}
const bundle = resolve(args.bundle);
const out = resolve(args.out);
const combo = JSON.parse(readFileSync(join(bundle, "combo.json"), "utf8"));
const omit =
  typeof args.omit === "string" ? args.omit.split(",").filter(Boolean) : [];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(HARNESS_ROOT, "fixture"), out, { recursive: true });
// Published sources (canary, pr) carry `mcpUse.specs` and no vendor/ directory.
const specs = combo.mcpUse.specs;
if (!specs)
  cpSync(join(bundle, "vendor"), join(out, "vendor"), { recursive: true });
cpSync(join(bundle, "combo.json"), join(out, "combo.json"));
if (existsSync(join(bundle, "sdk-variant.json")))
  cpSync(join(bundle, "sdk-variant.json"), join(out, "sdk-variant.json"));
// omit.json is baked into the source, never an environment variable (MF9).
writeFileSync(join(out, "omit.json"), `${JSON.stringify(omit)}\n`);

const sdk =
  combo.sdk.requested &&
  /^https?:/.test(String(Object.values(combo.sdk.requested)[0]))
    ? combo.sdk.requested
    : {
        client: combo.sdk.client,
        core: combo.sdk.core,
        server: combo.sdk.server,
      };
const manifest = fixtureManifest({
  sdk,
  extAppsPeer: combo.extAppsPeerOverride
    ? "$@modelcontextprotocol/ext-apps"
    : undefined,
  mcpUse: specs,
});
// Packages absent from this build (for example before events-core exists) are dropped.
for (const field of ["dependencies", "overrides"]) {
  for (const [name, spec] of Object.entries(manifest[field])) {
    if (spec.startsWith("file:") && !combo.mcpUse.versions[name])
      delete manifest[field][name];
    if (spec === `$${name}` && !combo.mcpUse.versions[name])
      delete manifest[field][name];
  }
}
writeFileSync(
  join(out, "package.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

if (!args["no-lock"]) {
  execFileSync(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    {
      cwd: out,
      stdio: "inherit",
    }
  );
  const lock = JSON.parse(readFileSync(join(out, "package-lock.json"), "utf8"));
  const problems = checkLockfile(lock, { sdk, mcpUse: specs }).filter(
    (p) => p.code !== "MCP_USE_MISSING" || combo.mcpUse.versions[p.name]
  );
  if (problems.length > 0) {
    console.error("[product] R3a lockfile resolution check failed:");
    for (const p of problems) console.error(`  ${JSON.stringify(p)}`);
    process.exit(1);
  }
  console.log(
    "R3a: lockfile resolves every mcp-use package to the bundle and the SDK to the variant"
  );
}
console.log(`staged fixture at ${out}`);
