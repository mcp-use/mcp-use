// Shared helpers for the Manufact dev-space E2E harness (PLAN.md §18.8).
// Everything here is pure or touches only local files, so it is unit-tested
// in ../tests and reused by every script and scenario.
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const WORKSPACE_ROOT = join(HARNESS_ROOT, "..", "..");

/** The packages packed from one variant build (§18.8.1 step 3). */
export const PACKED_PACKAGES = [
  { name: "mcp-use", dir: "server", file: "mcp-use.tgz" },
  { name: "@mcp-use/client", dir: "client", file: "mcp-use-client.tgz" },
  { name: "@mcp-use/cli", dir: "cli", file: "mcp-use-cli.tgz" },
  {
    name: "@mcp-use/inspector",
    dir: "inspector",
    file: "mcp-use-inspector.tgz",
  },
  {
    name: "@mcp-use/events-core",
    dir: "events-core",
    file: "mcp-use-events-core.tgz",
  },
  { name: "@mcp-use/agent", dir: "agent", file: "mcp-use-agent.tgz" },
  {
    name: "create-mcp-use-app",
    dir: "create-mcp-use-app",
    file: "create-mcp-use-app.tgz",
  },
];

/**
 * Where the mcp-use packages under test come from (PLAN.md §18.8.1):
 * - `pack`: tarballs packed from a workspace build per SDK variant (build-variant.mjs);
 * - `canary`: versions already published on npm under a dist-tag (default `canary`);
 * - `pr`: pkg.pr.new previews of one mcp-use commit (per-commit URLs, D83).
 * `canary` and `pr` have no SDK axis: the SDK is the one the published build compiled in.
 */
export const PACKAGE_SOURCES = ["pack", "canary", "pr"];

/** GitHub repository pkg.pr.new publishes mcp-use previews under. */
export const PREVIEW_REPO = "mcp-use/mcp-use";

/** Packages resolved for `canary`/`pr` sources (create-mcp-use-app is not a fixture dependency). */
export const PUBLISHED_PACKAGES = PACKED_PACKAGES.filter(
  (p) => p.name !== "create-mcp-use-app"
);

/** Packages that become direct fixture dependencies; the rest are overrides only. */
const DIRECT = new Set(["mcp-use", "@mcp-use/client", "@mcp-use/events-core"]);
const SDK = ["client", "core", "server"].map(
  (p) => `@modelcontextprotocol/${p}`
);

export function readMatrix() {
  return JSON.parse(readFileSync(join(HARNESS_ROOT, "matrix.json"), "utf8"));
}

/**
 * Branch name `r<runId>a<attempt>-<variant>` (weekly legs use prefix `w`).
 * With `pr`, the PR's dev-space branch `pr<number>-<variant>`: every push to
 * the PR redeploys the same preview branch, so the PR keeps one dev space.
 * At most 40 characters so `<slug>--br-<branch>` fits a 63-character DNS label.
 *
 * @param {{runId?: string | number, attempt?: string | number, variant: string, weekly?: boolean, pr?: string | number}} opts
 */
export function branchName({ runId, attempt, variant, weekly = false, pr }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(variant))
    throw new Error(`invalid variant name: ${variant}`);
  let name;
  if (pr !== undefined) {
    if (!/^\d+$/.test(String(pr)))
      throw new Error("pr must be a decimal integer");
    name = `pr${pr}-${variant}`;
  } else {
    if (!/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(attempt)))
      throw new Error("runId and attempt must be decimal integers");
    name = `${weekly ? "w" : "r"}${runId}a${attempt}-${variant}`;
  }
  if (name.length > 40)
    throw new Error(`branch name over 40 characters: ${name}`);
  return name;
}

/**
 * True for branches the janitor may remove: per-run `r<run>a<att>-` and PR
 * dev-space `pr<n>-` branches. `w*` is exempt.
 */
export function isJanitorBranch(branch) {
  return /^r\d+a\d+-/.test(branch) || isPrBranch(branch);
}

/** True for a PR dev-space branch `pr<n>-<variant>`. */
export function isPrBranch(branch) {
  return /^pr\d+-/.test(branch);
}

/**
 * `--commit-message` value the janitor also matches on. Ends with the build's
 * sha7, or with the mcp-use `version` for a canary bundle, which has no sha.
 *
 * @param {{runId: string | number, attempt: string | number, variant: string, sha?: string, version?: string}} opts
 */
export function commitMessage({ runId, attempt, variant, sha, version }) {
  const build = sha ? String(sha).slice(0, 7) : String(version);
  return `e2e ${runId}a${attempt} ${variant} ${build}`;
}

/** Per-run secrets derived inside one job, never passed between jobs (§18.8.7). */
export function deriveSecrets({ seed, runId, attempt, variant, webhooks = 2 }) {
  if (!seed) throw new Error("E2E_SECRET_SEED is required");
  const mac = (msg) => createHmac("sha256", seed).update(msg).digest("hex");
  const base = `${runId}:${attempt}:${variant}`;
  return {
    adminSecret: mac(base),
    webhookSecrets: Array.from(
      { length: webhooks },
      (_, n) => `whsec_e2e_${mac(`${base}:${n}`)}`
    ),
  };
}

/** Namespace hash `nsHash`: 16 chars of base64url(SHA-256(namespace)) (D24). */
export function nsHash(namespace) {
  return createHash("sha256")
    .update(namespace)
    .digest("base64url")
    .slice(0, 16);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The fixture `package.json` (§18.8.1). `sdk` is the SDK spec the variant
 * build compiled in: an exact version or a per-commit tarball URL. Without
 * `mcpUse`, every mcp-use package comes from `vendor/*.tgz` (source `pack`);
 * with it (`{name: spec}`, sources `canary`/`pr`), only the named packages are
 * listed, each pinned to its exact version or preview URL.
 *
 * @param {{sdk: string | Record<string, string>, extAppsPeer?: string, mcpUse?: Record<string, string>}} opts
 */
export function fixtureManifest({ sdk, extAppsPeer, mcpUse }) {
  const dependencies = {};
  const overrides = {};
  for (const pkg of PACKED_PACKAGES) {
    if (pkg.name === "create-mcp-use-app") continue;
    let spec = `file:./vendor/${pkg.file}`;
    if (mcpUse) {
      if (!mcpUse[pkg.name]) continue;
      spec = mcpUse[pkg.name];
    }
    if (DIRECT.has(pkg.name)) {
      dependencies[pkg.name] = spec;
      overrides[pkg.name] = `$${pkg.name}`;
    } else {
      overrides[pkg.name] = spec;
    }
  }
  // The fixture's own schema library (tool input schemas).
  dependencies.zod = "^4.6.6";
  for (const name of SDK) overrides[name] = sdkSpec(sdk, name);
  if (extAppsPeer) overrides["@modelcontextprotocol/ext-apps"] = extAppsPeer;
  return {
    name: "ev-e2e-fixture",
    private: true,
    type: "module",
    engines: { node: ">=22.22.2" },
    scripts: { build: "mcp-use build", start: "mcp-use start" },
    dependencies,
    overrides,
  };
}

function sdkSpec(sdk, name) {
  if (typeof sdk === "string") return sdk;
  return sdk[name.split("/")[1]];
}

/**
 * R3a: every `mcp-use`/`@mcp-use/*` entry in `package-lock.json` resolves to
 * `file:vendor/…` (or, with `mcpUse` `{name: spec}`, to exactly that version
 * or preview URL) and every `@modelcontextprotocol/{client,core,server}` entry
 * to the intended version or tarball URL. Returns the list of violations.
 *
 * @param {any} lock
 * @param {{sdk: string | Record<string, string>, mcpUse?: Record<string, string>}} opts
 */
export function checkLockfile(lock, { sdk, mcpUse }) {
  const problems = [];
  const seen = new Set();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === "") continue;
    const name =
      entry.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
    if (
      name === "mcp-use" ||
      name.startsWith("@mcp-use/") ||
      name === "create-mcp-use-app"
    ) {
      const resolved = entry.resolved ?? "";
      if (mcpUse) {
        seen.add(name);
        const want = mcpUse[name];
        const isUrl = /^https?:/.test(want ?? "");
        const got = isUrl ? resolved : (entry.version ?? resolved);
        if (want === undefined || got !== want)
          problems.push({
            code: "MCP_USE_SPEC_MISMATCH",
            name,
            path,
            want: want ?? null,
            got,
          });
        continue;
      }
      const ok = entry.link
        ? resolved.startsWith("vendor/")
        : resolved.startsWith("file:vendor/") || resolved.startsWith("vendor/");
      if (!ok)
        problems.push({ code: "MCP_USE_NOT_VENDORED", name, path, resolved });
      seen.add(name);
    } else if (SDK.includes(name)) {
      const want = sdkSpec(sdk, name);
      const ok = /^https?:/.test(want)
        ? entry.resolved === want
        : entry.version === want;
      if (!ok)
        problems.push({
          code: "SDK_MISMATCH",
          name,
          path,
          want,
          got: entry.resolved ?? entry.version,
        });
    }
  }
  for (const name of DIRECT)
    if (!seen.has(name) && (!mcpUse || mcpUse[name]))
      problems.push({ code: "MCP_USE_MISSING", name });
  return problems;
}

/**
 * E0 identity: compare what the running server reports with `combo.json`.
 * Returns mismatching fields as `{field, want, got}`.
 */
export function compareIdentity(combo, reported) {
  const pairs = [
    ["build.sha", combo.sha, reported?.build?.sha],
    ["sdk.bundled", combo.sdk?.server, reported?.sdk?.bundled],
    ["sdk.bundledHash", combo.sdk?.bundledHash, reported?.sdk?.bundledHash],
    ["sdk.external", combo.sdk?.server, reported?.sdk?.external],
    [
      "sdk.patchedPredicate",
      // Published sources do not know whether the build was patched: not compared.
      combo.patch === undefined ? undefined : combo.patch !== null,
      reported?.sdk?.patchedPredicate,
    ],
  ];
  return pairs
    .filter(([, want]) => want !== undefined)
    .filter(([, want, got]) => want !== got)
    .map(([field, want, got]) => ({ field, want, got }));
}

/** Failure classes reported separately in the run summary (§18.8.5). */
export const FAILURE_CLASSES = [
  "product-compile",
  "product",
  "infra",
  "platform-pending",
];

/** Error carrying a failure class, so the top-level runner can classify it. */
export class HarnessError extends Error {
  constructor(failureClass, message, details) {
    super(message);
    this.failureClass = failureClass;
    this.details = details;
  }
}

/** Parses `--key value` and `--flag` arguments into an object. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/**
 * argv for `mcp-use deploy` of a staged fixture to a per-run branch (§18.8.2).
 * `fallbackCommands` is MF3 fallback 1 (the platform ignores the lockfile).
 */
export function deployArgv({
  fixtureDir,
  server,
  branch,
  message,
  fallbackCommands = false,
  supportsCommitMessage = true,
}) {
  const argv = [
    "deploy",
    fixtureDir,
    "--server",
    server,
    "--branch",
    branch,
    "--no-github",
    "--json",
    "--yes",
  ];
  // TODO(events): --commit-message is a WP-39 CLI fix not yet in the CLI; deploy.mjs probes `deploy --help`.
  if (supportsCommitMessage) argv.push("--commit-message", message);
  if (fallbackCommands)
    argv.push(
      "--build-command",
      "npm ci && npx mcp-use build",
      "--start-command",
      "npx mcp-use start"
    );
  return argv;
}

/**
 * Janitor selection (§18.8.8): deployments of `serverId` on `r<run>a<att>-` branches
 * older than `maxAgeMs`, and on PR dev-space `pr<n>-` branches older than
 * `prMaxAgeMs` (default `maxAgeMs`). `w*` branches and other servers are never selected.
 */
export function janitorSelect(
  deployments,
  { serverId, now, maxAgeMs, prMaxAgeMs = maxAgeMs }
) {
  return deployments.filter((d) => {
    const branch = d.branch ?? "";
    if (d.serverId !== serverId || !isJanitorBranch(branch)) return false;
    const age = now - Date.parse(d.createdAt);
    return age > (isPrBranch(branch) ? prMaxAgeMs : maxAgeMs);
  });
}

/**
 * pkg.pr.new URL of one package at one mcp-use commit. Always per-commit
 * (first 7 hex characters), never a PR number, which moves with the PR (D83).
 */
export function previewUrl(name, ref, base = "https://pkg.pr.new") {
  if (!/^[0-9a-f]{7,40}$/.test(String(ref)))
    throw new Error(`preview ref must be a commit sha, got: ${ref}`);
  return `${base}/${PREVIEW_REPO}/${name}@${String(ref).slice(0, 7)}`;
}

/**
 * Resolves the `canary` source from npm packuments (`{name: packument}`; a
 * missing name is unpublished). `mcp-use@<tag>` is the anchor: the `@mcp-use/*`
 * packages it depends on take the exact versions it was published with, so
 * the set is consistent; the others take their own `<tag>`.
 * Returns `{versions, integrity, sdk, skipped}`.
 */
export function resolveCanary(packuments, { tag = "canary" } = {}) {
  const anchor = packuments["mcp-use"];
  const anchorVersion = anchor?.["dist-tags"]?.[tag];
  if (!anchorVersion)
    throw new HarnessError("infra", `mcp-use has no "${tag}" dist-tag`);
  const anchorDeps = anchor.versions?.[anchorVersion]?.dependencies ?? {};
  const versions = {};
  const integrity = {};
  const skipped = [];
  for (const { name } of PUBLISHED_PACKAGES) {
    const doc = packuments[name];
    const pinned = EXACT.test(anchorDeps[name] ?? "")
      ? anchorDeps[name]
      : undefined;
    const version =
      name === "mcp-use"
        ? anchorVersion
        : (pinned ?? doc?.["dist-tags"]?.[tag]);
    const manifest = version ? doc?.versions?.[version] : undefined;
    if (!manifest) {
      skipped.push(name);
      continue;
    }
    versions[name] = version;
    integrity[name] = manifest.dist?.integrity ?? null;
  }
  return {
    versions,
    integrity,
    sdk: sdkFromDependencies(anchorDeps),
    skipped,
  };
}

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * The exact SDK versions a published `mcp-use` manifest pins (D82), as
 * `{client, core, server}`. Throws when a pin is a range, because the fixture
 * could then resolve an SDK other than the compiled-in one.
 */
export function sdkFromDependencies(dependencies) {
  const sdk = {};
  for (const name of SDK) {
    const v = dependencies?.[name];
    if (!EXACT.test(v ?? ""))
      throw new HarnessError(
        "product",
        `published mcp-use pins ${name} to "${v}", not an exact version`
      );
    sdk[name.split("/")[1]] = v;
  }
  return sdk;
}

/** Reads an env var, treating `""` as unset (§18.8.7). */
export function env(name) {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}
