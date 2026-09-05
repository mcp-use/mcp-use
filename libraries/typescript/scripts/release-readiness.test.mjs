import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  changesetCheckArgs,
  pendingChangesets,
} from "./check-pr-changesets.mjs";
import { checkReleaseDocs, releaseDocsErrors } from "./check-release-docs.mjs";

// Fixture workspaces reuse the installed CLI; never install inside a test.
process.env.pnpm_config_verify_deps_before_run = "false";

const tsDoc = "docs/typescript/changelog/changelog.mdx";
const inspectorDoc = "docs/inspector/changelog.mdx";
const packages = [
  { name: "mcp-use", version: "2.4.4-canary.3" },
  { name: "@mcp-use/client", version: "1.2.0-canary.0" },
  { name: "@mcp-use/cli", version: "4.2.0-canary.0" },
  { name: "@mcp-use/inspector", version: "20.4.0-canary.1" },
];
const entry = (v, body = "- **Fix**: Reconnect after a timeout.") =>
  `<Update label="v${v}" description="September 2026">\n${body}\n</Update>`;
const docs = { [tsDoc]: entry("2.4.4"), [inspectorDoc]: entry("20.4.0") };
function errors(releases, documents = docs, previousDocuments) {
  return releaseDocsErrors({
    packages,
    releases,
    documents,
    previousDocuments,
  });
}

test("docs use stable labels for prereleases and route Inspector separately", () => {
  assert.deepEqual(errors(packages), []);
  assert.deepEqual(
    errors([packages[3]], { [inspectorDoc]: docs[inspectorDoc] }),
    []
  );
  assert.deepEqual(
    errors([packages[1], packages[2]], { [tsDoc]: docs[tsDoc] }),
    []
  );
  assert.deepEqual(errors([], {}), []);
});

test("projected versions take precedence over current manifests", () => {
  assert.match(
    errors([{ name: "mcp-use", newVersion: "2.5.0-canary.0" }])[0],
    /v2\.5\.0/
  );
  assert.deepEqual(
    errors([{ name: "mcp-use", newVersion: "2.5.0-canary.0" }], {
      [tsDoc]: entry("2.5.0"),
    }),
    []
  );
});

test("docs reject missing, stale, duplicate, hidden, and empty entries", () => {
  for (const content of [
    "",
    entry("2.4.3"),
    entry("2.4.3") + docs[tsDoc],
    docs[tsDoc] + docs[tsDoc],
    `<!-- ${docs[tsDoc]} -->`,
    `{/* ${docs[tsDoc]} */}`,
    `\`\`\`mdx\n${docs[tsDoc]}\n\`\`\``,
    entry("2.4.4", "## Coming soon"),
  ]) {
    assert.ok(errors([packages[0]], { [tsDoc]: content }).length, content);
  }
});

test("promotion requires actual note changes, not whitespace edits", () => {
  assert.match(errors([packages[0]], docs, docs)[0], /unchanged/);
  assert.match(
    errors(
      [packages[0]],
      { ...docs, [tsDoc]: docs[tsDoc].replace("Reconnect", "  Reconnect") },
      docs
    )[0],
    /unchanged/
  );
  assert.deepEqual(
    errors([packages[0]], docs, { [tsDoc]: entry("2.4.3") }),
    []
  );
});

test("ordinary PRs always compare against their exact base; versioned releases need no extra bump", () => {
  const base = "a".repeat(40);
  assert.deepEqual(
    changesetCheckArgs({ base, mode: "ordinary", pending: [] }),
    ["exec", "changeset", "status", "--since", base]
  );
  assert.equal(
    changesetCheckArgs({ base, mode: "promotion", pending: [] }),
    null
  );
  assert.ok(changesetCheckArgs({ base, mode: "promotion", pending: ["new"] }));
  assert.equal(
    changesetCheckArgs({ base, mode: "version", pending: [] }),
    null
  );
  assert.throws(
    () => changesetCheckArgs({ base: "main", mode: "ordinary", pending: [] }),
    /exact base/
  );
  assert.throws(
    () => changesetCheckArgs({ base, mode: "skip", pending: [] }),
    /Unknown/
  );
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-readiness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "libraries/typescript");
  function write(file, value) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), value);
  }
  const json = (file, value) => write(file, JSON.stringify(value));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  json("package.json", { private: true });
  json("libraries/typescript/package.json", {
    private: true,
    workspaces: ["packages/*"],
  });
  write(
    "libraries/typescript/pnpm-workspace.yaml",
    "packages:\n  - packages/*\n"
  );
  json("libraries/typescript/packages/server/package.json", {
    name: "mcp-use",
    version: "2.4.3",
  });
  write(
    "libraries/typescript/packages/server/src/index.js",
    "export const a = 1;\n"
  );
  json("libraries/typescript/.changeset/config.json", {
    changelog: false,
    commit: false,
    fixed: [],
    linked: [],
    access: "public",
    baseBranch: "main",
    updateInternalDependencies: "patch",
    ignore: [],
  });
  write("libraries/typescript/.changeset/README.md", "# Changesets\n");
  write(".gitignore", "node_modules\nplan.json\n");
  write(tsDoc, entry("2.4.3"));
  git("init", "-b", "main");
  git("config", "user.email", "ci-test@example.invalid");
  git("config", "user.name", "CI fixture");
  git("add", ".");
  git("commit", "-m", "baseline");
  const base = git("rev-parse", "HEAD");
  const realWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  symlinkSync(
    join(realWorkspace, "node_modules"),
    join(workspace, "node_modules"),
    "dir"
  );
  return { root, workspace, write, json, git, base };
}

test("real Changesets CLI fails a missing PR changeset despite an older base changeset", (t) => {
  const f = fixture(t);
  f.write(
    "libraries/typescript/.changeset/old.md",
    '---\n"mcp-use": patch\n---\n\nOlder change\n'
  );
  f.git("add", ".");
  f.git("commit", "-m", "old changeset");
  const base = f.git("rev-parse", "HEAD");
  f.write(
    "libraries/typescript/packages/server/src/index.js",
    "export const a = 2;\n"
  );
  f.git("add", ".");
  f.git("commit", "-m", "new code without changeset");
  const run = () =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./check-pr-changesets.mjs", import.meta.url))],
      {
        cwd: f.workspace,
        env: { ...process.env, PR_BASE_SHA: base, PR_RELEASE_MODE: "ordinary" },
        encoding: "utf8",
      }
    );
  const missing = run();
  assert.notEqual(missing.status, 0, missing.stdout);
  assert.match(missing.stderr, /Changeset validation failed/);
  f.write(
    "libraries/typescript/.changeset/new.md",
    '---\n"mcp-use": patch\n---\n\nNew change\n'
  );
  f.git("add", ".");
  f.git("commit", "-m", "add PR changeset");
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
});

test("real Changesets CLI accepts an explicit empty changeset", (t) => {
  const f = fixture(t);
  f.write(
    "libraries/typescript/packages/server/src/index.js",
    "export const a = 2;\n"
  );
  f.write("libraries/typescript/.changeset/no-release.md", "---\n---\n\n");
  f.git("add", ".");
  f.git("commit", "-m", "intentional no release");
  const result = spawnSync(
    "pnpm",
    ["exec", "changeset", "status", "--since", f.base],
    { cwd: f.workspace, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
});

test("applied canary changesets are excluded but new ones remain pending", (t) => {
  const f = fixture(t);
  f.write("libraries/typescript/.changeset/applied.md", "---\n---\n");
  f.write("libraries/typescript/.changeset/new.md", "---\n---\n");
  f.json("libraries/typescript/.changeset/pre.json", {
    changesets: ["applied"],
  });
  assert.deepEqual(pendingChangesets(f.workspace), ["new"]);
});

test("full docs gate checks projected versions and publication snapshots without mutating versions", (t) => {
  const f = fixture(t);
  f.write(
    "libraries/typescript/.changeset/new.md",
    '---\n"mcp-use": patch\n---\n\nFix reconnect\n'
  );
  assert.throws(
    () => checkReleaseDocs({ workspaceRoot: f.workspace }),
    /v2\.4\.4/
  );
  f.write(tsDoc, entry("2.4.4"));
  checkReleaseDocs({ workspaceRoot: f.workspace });
  assert.equal(
    JSON.parse(
      readFileSync(join(f.workspace, "packages/server/package.json"), "utf8")
    ).version,
    "2.4.3"
  );
  f.json("plan.json", {
    releases: [{ name: "mcp-use", version: "2.4.4", target: true }],
  });
  checkReleaseDocs({
    workspaceRoot: f.workspace,
    planFile: join(f.root, "plan.json"),
  });
  f.write(tsDoc, entry("2.4.3"));
  assert.throws(
    () =>
      checkReleaseDocs({
        workspaceRoot: f.workspace,
        planFile: join(f.root, "plan.json"),
      }),
    /v2\.4\.4/
  );
});

test("version PR accepts inherited docs while promotion requires fresh notes", (t) => {
  const f = fixture(t);
  f.json("libraries/typescript/packages/server/package.json", {
    name: "mcp-use",
    version: "2.4.3-canary.0",
  });
  f.git("add", ".");
  f.git("commit", "-m", "prerelease baseline");
  const base = f.git("rev-parse", "HEAD");
  f.json("libraries/typescript/packages/server/package.json", {
    name: "mcp-use",
    version: "2.4.3",
  });
  f.git("add", ".");
  f.git("commit", "-m", "exit prerelease");
  f.json("plan.json", { releases: [] });
  const options = {
    workspaceRoot: f.workspace,
    planFile: join(f.root, "plan.json"),
    base,
  };
  assert.throws(() => checkReleaseDocs(options), /unchanged/);
  checkReleaseDocs({ ...options, allowExisting: true });
});

test("no-release package changes need no fabricated changelog entry", (t) => {
  const f = fixture(t);
  f.write(
    "libraries/typescript/packages/server/tests/unit.js",
    "// additional test\n"
  );
  f.git("add", ".");
  f.git("commit", "-m", "tests only");
  f.json("plan.json", { releases: [] });
  checkReleaseDocs({
    workspaceRoot: f.workspace,
    planFile: join(f.root, "plan.json"),
    base: f.base,
  });
});

test("ordinary PRs into a prerelease branch still need their own changeset", (t) => {
  const f = fixture(t);
  f.json("libraries/typescript/packages/server/package.json", {
    name: "mcp-use",
    version: "2.4.4-canary.0",
  });
  f.write(
    "libraries/typescript/.changeset/applied.md",
    '---\n"mcp-use": patch\n---\n\nAlready shipped to canary\n'
  );
  f.json("libraries/typescript/.changeset/pre.json", {
    mode: "pre",
    tag: "canary",
    initialVersions: { "mcp-use": "2.4.3" },
    changesets: ["applied"],
  });
  f.git("add", ".");
  f.git("commit", "-m", "canary version baseline");
  const base = f.git("rev-parse", "HEAD");
  assert.throws(
    () => checkReleaseDocs({ workspaceRoot: f.workspace }),
    /v2\.4\.4/
  );
  f.write(tsDoc, entry("2.4.4"));
  checkReleaseDocs({ workspaceRoot: f.workspace });
  f.write(
    "libraries/typescript/packages/server/src/index.js",
    "export const a = 3;\n"
  );
  f.git("add", ".");
  f.git("commit", "-m", "new canary PR");
  const run = () =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./check-pr-changesets.mjs", import.meta.url))],
      {
        cwd: f.workspace,
        env: { ...process.env, PR_BASE_SHA: base, PR_RELEASE_MODE: "ordinary" },
        encoding: "utf8",
      }
    );
  assert.notEqual(run().status, 0);
  f.write(
    "libraries/typescript/.changeset/pr.md",
    '---\n"mcp-use": patch\n---\n\nNew canary change\n'
  );
  f.git("add", ".");
  f.git("commit", "-m", "new PR changeset");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});
