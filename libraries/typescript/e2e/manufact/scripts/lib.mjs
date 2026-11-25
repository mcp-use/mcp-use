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
 * At most 40 characters so `<slug>--br-<branch>` fits a 63-character DNS label.
 */
export function branchName({ runId, attempt, variant, weekly = false }) {
  if (!/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(attempt)))
    throw new Error("runId and attempt must be decimal integers");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(variant))
    throw new Error(`invalid variant name: ${variant}`);
  const name = `${weekly ? "w" : "r"}${runId}a${attempt}-${variant}`;
  if (name.length > 40)
    throw new Error(`branch name over 40 characters: ${name}`);
  return name;
}

/** True for branches the janitor may remove (`^r\d+a\d+-`; `w*` is exempt). */
export function isJanitorBranch(branch) {
  return /^r\d+a\d+-/.test(branch);
}

/** `--commit-message` value the janitor also matches on. */
export function commitMessage({ runId, attempt, variant, sha }) {
  return `e2e ${runId}a${attempt} ${variant} ${String(sha).slice(0, 7)}`;
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
 * build compiled in: an exact version or a per-commit tarball URL.
 */
export function fixtureManifest({ sdk, extAppsPeer }) {
  const dependencies = {};
  const overrides = {};
  for (const pkg of PACKED_PACKAGES) {
    if (pkg.name === "create-mcp-use-app") continue;
    if (DIRECT.has(pkg.name)) {
      dependencies[pkg.name] = `file:./vendor/${pkg.file}`;
      overrides[pkg.name] = `$${pkg.name}`;
    } else {
      overrides[pkg.name] = `file:./vendor/${pkg.file}`;
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
 * `file:vendor/…` and every `@modelcontextprotocol/{client,core,server}` entry to
 * the intended version or tarball URL. Returns the list of violations.
 */
export function checkLockfile(lock, { sdk }) {
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
    if (!seen.has(name)) problems.push({ code: "MCP_USE_MISSING", name });
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
      combo.patch !== null,
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
 * older than `maxAgeMs`. `w*` branches and other servers are never selected.
 */
export function janitorSelect(deployments, { serverId, now, maxAgeMs }) {
  return deployments.filter(
    (d) =>
      d.serverId === serverId &&
      isJanitorBranch(d.branch ?? "") &&
      now - Date.parse(d.createdAt) > maxAgeMs
  );
}

/** Reads an env var, treating `""` as unset (§18.8.7). */
export function env(name) {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}
