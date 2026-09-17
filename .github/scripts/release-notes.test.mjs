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

function fixture(t) {
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

test("an explicit empty changeset permits internal work", (t) => {
  const f = fixture(t);
  f.write(`${changeset}internal.md`, "---\n---\n");
  assert.deepEqual(f.check(), []);
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

test("other main PRs pass without release notes", (t) => {
  assert.deepEqual(fixture(t).check("main", "changeset-release/main"), []);
});

test("unrelated changes added to the base branch cannot satisfy the PR", (t) => {
  const f = fixture(t);
  const head = f.commit();
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
