#!/usr/bin/env node
// Switch a SCRATCH checkout of this workspace to one SDK matrix leg, install,
// build, and record what was actually compiled in (PLAN.md D82-D83, §18).
//
//   node scripts/sdk-matrix/apply.mjs <leg> [--scratch]
//
// Legs:
//   pinned      the version in catalogs.mcp-sdk (no change)
//   latest      npm dist-tag `latest`
//   prerelease  npm dist-tag `next`, else `beta`, else `alpha`
//   main        pkg.pr.new build of the SDK's main branch head
//   pr-3209     pkg.pr.new build of typescript-sdk PR #3209's head
//   candidate   the version in $SDK_CANDIDATE (an exact version or tarball URL)
//
// It rewrites pnpm-workspace.yaml and the lockfile, so it refuses to run unless
// --scratch is passed or MCP_USE_SDK_MATRIX_SCRATCH=1 is set: run it in a CI
// checkout or a throwaway `git worktree`, never in a developer's checkout.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "pnpm-workspace.yaml");
const SDK = ["client", "core", "server"].map(
  (p) => `@modelcontextprotocol/${p}`
);
const PKG_PR_NEW = "https://pkg.pr.new/modelcontextprotocol/typescript-sdk";
const LEGS = ["pinned", "latest", "prerelease", "main", "pr-3209", "candidate"];

const leg = process.argv[2];
if (!LEGS.includes(leg)) {
  console.error(`usage: apply.mjs <${LEGS.join("|")}> [--scratch]`);
  process.exit(2);
}
if (
  !process.argv.includes("--scratch") &&
  process.env.MCP_USE_SDK_MATRIX_SCRATCH !== "1"
) {
  console.error(
    "apply.mjs rewrites the workspace; pass --scratch in a throwaway checkout."
  );
  process.exit(2);
}

const run = (cmd, args, opts = {}) =>
  (
    execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      ...opts,
    }) ?? ""
  ).trim();

function pinnedVersion(yaml) {
  const m =
    /^catalogs:\n {2}mcp-sdk:\n(?: {4}.+\n)*? {4}"?@modelcontextprotocol\/server"?:\s*(\S+)/m.exec(
      yaml
    );
  if (!m)
    throw new Error("catalogs.mcp-sdk.@modelcontextprotocol/server not found");
  return m[1];
}

function distTag(tag) {
  try {
    return (
      run("npm", ["view", `@modelcontextprotocol/server@${tag}`, "version"]) ||
      null
    );
  } catch {
    return null;
  }
}

function ghJq(path, jq) {
  return run("gh", [
    "api",
    `repos/modelcontextprotocol/typescript-sdk/${path}`,
    "--jq",
    jq,
  ]);
}

/** @returns {{ requested: string, specs: Record<string,string>, version: string|null, prHeadSha?: string }} */
function resolveLeg(yaml) {
  const exact = (v) => ({
    requested: v,
    version: v,
    specs: Object.fromEntries(SDK.map((n) => [n, v])),
  });
  const tarballs = (ref, extra = {}) => ({
    requested: ref,
    version: null,
    specs: Object.fromEntries(SDK.map((n) => [n, `${PKG_PR_NEW}/${n}@${ref}`])),
    ...extra,
  });
  switch (leg) {
    case "pinned":
      return exact(pinnedVersion(yaml));
    case "latest":
      return exact(distTag("latest") ?? fail("npm has no latest tag"));
    case "prerelease":
      return exact(
        distTag("next") ??
          distTag("beta") ??
          distTag("alpha") ??
          fail("no prerelease dist-tag")
      );
    case "main":
      return tarballs(ghJq("commits/main", ".sha").slice(0, 7));
    case "pr-3209": {
      return tarballs("3209", { prHeadSha: ghJq("pulls/3209", ".head.sha") });
    }
    case "candidate": {
      const c = process.env.SDK_CANDIDATE ?? fail("set SDK_CANDIDATE");
      return /^https?:/.test(c)
        ? {
            requested: c,
            version: null,
            specs: Object.fromEntries(
              SDK.map((n) => [n, c.replace("{pkg}", n)])
            ),
          }
        : exact(c);
    }
  }
}

function fail(message) {
  throw new Error(message);
}

let yaml = readFileSync(WORKSPACE, "utf8");
const target = resolveLeg(yaml);

// 1. Point the catalog at the leg.
yaml = yaml.replace(
  /^(catalogs:\n {2}mcp-sdk:\n)((?: {4}.+\n)+)/m,
  (_, head) =>
    head +
    SDK.map((n) => `    "${n}": ${JSON.stringify(target.specs[n])}\n`).join("")
);

// 2. Keep the SDK patch only when one exists for exactly this version; never allow unused patches.
const patchLine =
  /^ {2}"@modelcontextprotocol\/server@[^"]+": patches\/sdk\/[^\n]+\n/m;
const patchFile =
  target.version && join("patches", "sdk", `${target.version}.patch`);
const patched = Boolean(patchFile && existsSync(join(ROOT, patchFile)));
yaml = yaml.replace(
  patchLine,
  patched
    ? `  "@modelcontextprotocol/server@${target.version}": ${patchFile}\n`
    : ""
);

// 3. ext-apps peers on ^2.0.0, which prerelease and tarball versions do not satisfy.
const peerOverride = leg !== "pinned" && leg !== "latest";
if (peerOverride && !/^peerDependencyRules:/m.test(yaml)) {
  yaml += `\npeerDependencyRules:\n  allowAny:\n    - "@modelcontextprotocol/*"\n`;
}
writeFileSync(WORKSPACE, yaml);

// 4. Install and build.
run("pnpm", ["install", "--no-frozen-lockfile"], { stdio: "inherit" });
run("pnpm", ["build"], { stdio: "inherit" });

// 5. Record what was resolved and what each artifact compiled in.
const installed = (pkgDir, name) => {
  const script = `const {createRequire}=require("node:module");const p=require("node:path");const fs=require("node:fs");let d=p.dirname(createRequire(p.join(process.argv[1],"package.json")).resolve(process.argv[2]));for(;;){try{const m=JSON.parse(fs.readFileSync(p.join(d,"package.json"),"utf8"));if(m.name===process.argv[2]){console.log(m.version);break}}catch{}const q=p.dirname(d);if(q===d)process.exit(1);d=q}`;
  return run("node", ["-e", script, join(ROOT, "packages", pkgDir), name]);
};
const sdkInfo = (pkg) =>
  JSON.parse(
    readFileSync(join(ROOT, "packages", pkg, "dist", "sdk-info.json"), "utf8")
  ).sdk;
const variant = {
  leg,
  requested: target.requested,
  resolved: {
    server: installed("server", "@modelcontextprotocol/server"),
    client: installed("client", "@modelcontextprotocol/client"),
    core: installed("server", "@modelcontextprotocol/core"),
  },
  ...(target.prHeadSha ? { prHeadSha: target.prHeadSha } : {}),
  patch: patched ? patchFile : null,
  peerOverride,
  bundled: { "mcp-use": sdkInfo("server"), cli: sdkInfo("cli") },
};
writeFileSync(
  join(ROOT, "sdk-variant.json"),
  `${JSON.stringify(variant, null, 2)}\n`
);
console.log(JSON.stringify(variant, null, 2));
if (
  variant.bundled["mcp-use"].bundled !== variant.resolved.server ||
  variant.bundled.cli.bundled !== variant.resolved.server
) {
  console.error("bundled SDK differs from the resolved SDK");
  process.exit(1);
}
