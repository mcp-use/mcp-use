#!/usr/bin/env node
// Build one SDK variant of the workspace and pack it (PLAN.md §18.8.1 steps 1-4).
//
//   node e2e/manufact/scripts/build-variant.mjs <variant> --out <dir>
//        [--sha <commit>] [--attempt <n>] [--scratch <dir>] [--keep]
//
// Steps: `git worktree add` a scratch checkout of <sha> (default HEAD) under
// --scratch (default: a temp dir), run `scripts/sdk-matrix/apply.mjs <variant>
// --scratch` there (install + build; failure = product-compile), `pnpm pack`
// every package in PACKED_PACKAGES into <out>/vendor/, and write
// <out>/sdk-variant.json and <out>/combo.json. Never touches the caller's
// checkout or node_modules.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  HarnessError,
  PACKED_PACKAGES,
  WORKSPACE_ROOT,
  parseArgs,
  readMatrix,
  sha256File,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const variant = args._[0];
const matrix = readMatrix();
if (!matrix.variants[variant]) {
  console.error(
    `usage: build-variant.mjs <${Object.keys(matrix.variants).join("|")}> --out <dir>`
  );
  process.exit(2);
}
if (typeof args.out !== "string") {
  console.error("--out <dir> is required");
  process.exit(2);
}
const out = resolve(args.out);
const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...opts,
  }).trim();

const repoRoot = run("git", [
  "-C",
  WORKSPACE_ROOT,
  "rev-parse",
  "--show-toplevel",
]);
const sha = run("git", [
  "-C",
  repoRoot,
  "rev-parse",
  typeof args.sha === "string" ? args.sha : "HEAD",
]);
const scratchBase =
  typeof args.scratch === "string"
    ? resolve(args.scratch)
    : mkdtempSync(join(tmpdir(), "ev-e2e-"));
const clone = join(scratchBase, `ws-${variant}-${sha.slice(0, 7)}`);

function writeLocalSdkVariant(ws, outDir) {
  const version = (pkgDir, name) =>
    JSON.parse(
      readFileSync(
        join(
          ws,
          "packages",
          pkgDir,
          "node_modules",
          ...name.split("/"),
          "package.json"
        ),
        "utf8"
      )
    ).version;
  const info = (pkg) => {
    const file = join(ws, "packages", pkg, "dist", "sdk-info.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).sdk : null;
  };
  const server = version("server", "@modelcontextprotocol/server");
  const patch = join("patches", "sdk", `${server}.patch`);
  const variantJson = {
    leg: "pinned",
    requested: { server, client: server, core: server },
    resolved: {
      server,
      client: version("client", "@modelcontextprotocol/client"),
      core: version("server", "@modelcontextprotocol/core"),
    },
    patch: existsSync(join(ws, patch)) ? patch : null,
    peerOverride: false,
    bundled: { "mcp-use": info("server"), cli: info("cli") },
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "sdk-variant.json"),
    `${JSON.stringify(variantJson, null, 2)}\n`
  );
}

// --from-workspace packs the caller's already-built workspace as the `pinned`
// variant (local iteration only: nothing is installed or rebuilt, and the
// packages must be built first). CI always uses the scratch clone.
const fromWorkspace = Boolean(args["from-workspace"]);
if (fromWorkspace && variant !== "pinned") {
  console.error("--from-workspace only supports the pinned variant");
  process.exit(2);
}

try {
  let ws = WORKSPACE_ROOT;
  if (fromWorkspace) {
    writeLocalSdkVariant(ws, out);
  } else {
    if (!existsSync(clone))
      run("git", ["-C", repoRoot, "worktree", "add", "--detach", clone, sha], {
        stdio: "inherit",
      });
    ws = join(clone, "libraries", "typescript");
    try {
      run(
        "node",
        [
          "scripts/sdk-matrix/apply.mjs",
          matrix.variants[variant].leg,
          "--scratch",
        ],
        { cwd: ws, stdio: "inherit" }
      );
    } catch (error) {
      throw new HarnessError(
        "product-compile",
        `variant ${variant} failed to install or build`,
        String(error)
      );
    }
    copyFileSync(join(ws, "sdk-variant.json"), join(out, "sdk-variant.json"));
  }

  mkdirSync(join(out, "vendor"), { recursive: true });
  const versions = {};
  const tarballSha256 = {};
  for (const pkg of PACKED_PACKAGES) {
    const dir = join(ws, "packages", pkg.dir);
    if (!existsSync(dir)) {
      // TODO(events): events-core lands with WP-01; until then it is skipped with a note.
      console.warn(
        `skip ${pkg.name}: packages/${pkg.dir} does not exist in ${sha.slice(0, 7)}`
      );
      continue;
    }
    const before = new Set(readdirSync(dir));
    run("pnpm", ["pack", "--pack-destination", dir], { cwd: dir });
    const produced = readdirSync(dir).find(
      (f) => f.endsWith(".tgz") && !before.has(f)
    );
    if (!produced)
      throw new HarnessError(
        "product-compile",
        `pnpm pack produced no tarball for ${pkg.name}`
      );
    const target = join(out, "vendor", pkg.file);
    renameSync(join(dir, produced), target);
    versions[pkg.name] = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8")
    ).version;
    tarballSha256[pkg.name] = sha256File(target);
  }

  const sdkVariant = JSON.parse(
    readFileSync(join(out, "sdk-variant.json"), "utf8")
  );
  const agentManifest = join(ws, "packages", "agent", "package.json");
  const combo = {
    sha,
    attempt: Number(args.attempt ?? process.env.GITHUB_RUN_ATTEMPT ?? 1),
    variant,
    mcpUse: { versions, tarballSha256 },
    sdk: {
      ...sdkVariant.resolved,
      requested: sdkVariant.requested,
      bundledHash: sdkVariant.bundled?.["mcp-use"]?.bundledHash,
      ...(sdkVariant.prHeadSha ? { prHeadSha: sdkVariant.prHeadSha } : {}),
    },
    patch: sdkVariant.patch,
    extAppsPeerOverride: sdkVariant.peerOverride,
    agentV1Sdk: existsSync(agentManifest)
      ? (JSON.parse(readFileSync(agentManifest, "utf8")).dependencies?.[
          "@modelcontextprotocol/sdk"
        ] ?? null)
      : null,
  };
  writeFileSync(join(out, "combo.json"), `${JSON.stringify(combo, null, 2)}\n`);
  console.log(JSON.stringify(combo, null, 2));
} catch (error) {
  const failureClass =
    error instanceof HarnessError ? error.failureClass : "infra";
  console.error(`[${failureClass}] ${error.message}`);
  process.exitCode = 1;
} finally {
  if (!args.keep && !fromWorkspace && existsSync(clone)) {
    try {
      run("git", ["-C", repoRoot, "worktree", "remove", "--force", clone]);
    } catch {
      rmSync(clone, { recursive: true, force: true });
    }
  }
}
