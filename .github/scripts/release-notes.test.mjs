import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { changelogs, checkReleaseNotes } from "./release-notes.mjs";

const changeset = "libraries/typescript/.changeset/";
const release = '---\n"mcp-use": patch\n---\n\nFix a bug.\n';
const entry = '<Update label="v1.0.0">Initial release</Update>\n';

function fixture(t, { sdk = true } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "release-notes-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "fixture",
      "--allow-empty",
    );
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  git("config", "commit.gpgsign", "false");
  write(`${changeset}existing.md`, release);
  for (const path of changelogs) write(path, entry);
  const base = commit();
  if (sdk)
    write(
      "libraries/typescript/packages/server/src/index.ts",
      "export const changed = true;\n",
    );
  const check = (baseBranch = "canary", headBranch = "feature") =>
    checkReleaseNotes({ cwd, base, head: commit(), baseBranch, headBranch });
  return { write, check, git, commit, base, cwd };
}

test("existing, edited, and README changesets do not satisfy a canary PR", (t) => {
  const f = fixture(t);
  assert.equal(f.check().length, 1);
  f.write(`${changeset}existing.md`, release + "More details.");
  f.write(`${changeset}README.md`, release);
  assert.equal(f.check().length, 1);
});

test("a new release changeset satisfies a canary PR", (t) => {
  const f = fixture(t);
  f.write(`${changeset}new.md`, release);
  assert.deepEqual(f.check(), []);
});

test("an empty changeset does not satisfy SDK changes", (t) => {
  const f = fixture(t);
  f.write(`${changeset}internal.md`, "---\n---\n");
  assert.equal(f.check().length, 1);
});

test("malformed changesets and release entries without summaries fail", (t) => {
  const f = fixture(t);
  for (const content of [
    "",
    "Not a changeset",
    '---\n"mcp-use": invalid\n---\nSummary',
    '---\n"mcp-use": patch\n---\n',
  ]) {
    f.write(`${changeset}new.md`, content);
    assert.equal(f.check().length, 1);
  }
});

test("canary to main requires both MDX changelogs", (t) => {
  const f = fixture(t);
  assert.equal(f.check("main", "canary").length, 2);
  f.write(
    changelogs[0],
    '<Update label="v1.1.0">New feature</Update>\n' + entry,
  );
  assert.equal(f.check("main", "canary").length, 1);
  f.write(
    changelogs[1],
    '<Update label="v2.0.0">Inspector feature</Update>\n' + entry,
  );
  assert.deepEqual(f.check("main", "canary"), []);
});

test("metadata, whitespace, empty entries, and generated changelogs do not count", (t) => {
  const f = fixture(t);
  for (const path of changelogs) {
    f.write(
      path,
      '---\ntitle: Changed\n---\n<Update label="v2.0.0"> </Update>\n<Update label="v1.0.1">Initial   release</Update>',
    );
  }
  f.write("libraries/typescript/packages/server/CHANGELOG.md", "New release");
  assert.equal(f.check("main", "canary").length, 2);
});

test("updating an existing release entry is allowed", (t) => {
  const f = fixture(t);
  for (const path of changelogs)
    f.write(
      path,
      entry.replace("Initial release", "Initial release with new fixes"),
    );
  assert.deepEqual(f.check("main", "canary"), []);
});

test("SDK PRs require changesets for every target, including main", (t) => {
  const f = fixture(t);
  for (const branch of ["main", "canary", "feature/another-base"]) {
    assert.equal(f.check(branch).length, 1);
  }
  f.write(`${changeset}new.md`, release);
  for (const branch of ["main", "canary", "feature/another-base"]) {
    assert.deepEqual(f.check(branch), []);
  }
});

test("unrelated changes added to the base branch cannot satisfy the PR", (t) => {
  const f = fixture(t);
  const head = f.commit();
  f.git("checkout", "--detach", f.base);
  f.write(`${changeset}base-only.md`, release);
  const base = f.commit();
  assert.equal(
    checkReleaseNotes({
      cwd: f.cwd,
      base,
      head,
      baseBranch: "canary",
      headBranch: "feature",
    }).length,
    1,
  );
});

test("docs, Python, examples, tests, and tooling changes need no changeset", (t) => {
  const f = fixture(t, { sdk: false });
  for (const path of [
    "docs/typescript/server.mdx",
    "libraries/python/mcp_use/server.py",
    ".github/workflows/ci.yml",
    "libraries/typescript/scripts/tool.mjs",
    "libraries/typescript/packages/server/README.md",
    "libraries/typescript/packages/server/examples/basic/index.ts",
    "libraries/typescript/packages/client/tests/setup.ts",
    "libraries/typescript/packages/client/src/hooks/useMcp.test.tsx",
    "libraries/typescript/packages/server/src/__tests__/fixtures/data.json",
    "libraries/typescript/packages/inspector/e2e/chat.spec.ts",
    "libraries/typescript/packages/cli/vitest.config.ts",
    "libraries/typescript/packages/server/tsconfig.test.json",
    "libraries/typescript/packages/agent/typedoc.json",
  ])
    f.write(path, "test-only content");
  assert.deepEqual(f.check("main"), []);
  assert.deepEqual(f.check("canary"), []);
  f.write("libraries/typescript/packages/server/src/index.ts", "SDK change");
  assert.equal(f.check("main").length, 1);
});

test("all published TS packages, assets, build files, and shipped templates count", (t) => {
  for (const path of [
    "server/src/index.ts",
    "client/src/index.ts",
    "agent/src/index.ts",
    "cli/src/index.ts",
    "inspector/src/styles.css",
    "tunnel/src/index.ts",
    "server/tsup.config.ts",
    "create-mcp-use-app/src/templates/blank/README.md",
  ]) {
    const f = fixture(t, { sdk: false });
    f.write(`libraries/typescript/packages/${path}`, "SDK change");
    assert.equal(f.check("main").length, 1, path);
  }
});

test("runtime manifest edits count but version, scripts, and dev dependencies do not", (t) => {
  const f = fixture(t, { sdk: false });
  const path = "libraries/typescript/packages/server/package.json";
  const original = {
    name: "mcp-use",
    version: "1.0.0",
    dependencies: { dep: "1.0.0" },
  };
  f.write(path, JSON.stringify(original));
  const base = f.commit();
  const check = (headBranch = "feature") =>
    checkReleaseNotes({
      cwd: f.cwd,
      base,
      head: f.commit(),
      baseBranch: "main",
      headBranch,
    });
  f.write(
    path,
    JSON.stringify({
      ...original,
      version: "1.0.1",
      scripts: { test: "vitest" },
      devDependencies: { vitest: "4" },
    }),
  );
  assert.deepEqual(check(), []);
  f.write(
    path,
    JSON.stringify({ ...original, dependencies: { dep: "2.0.0" } }),
  );
  assert.equal(check().length, 1);
  assert.deepEqual(check("release/exit-prerelease-1234"), []);
  f.write("libraries/typescript/packages/server/src/index.ts", "SDK change");
  assert.equal(check("release/exit-prerelease-1234").length, 1);
});

test("deleted SDK source files still require a changeset", (t) => {
  const f = fixture(t);
  const base = f.commit();
  rmSync(join(f.cwd, "libraries/typescript/packages/server/src/index.ts"));
  assert.equal(
    checkReleaseNotes({
      cwd: f.cwd,
      base,
      head: f.commit(),
      baseBranch: "main",
      headBranch: "feature",
    }).length,
    1,
  );
});
