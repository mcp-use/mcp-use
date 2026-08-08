import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./release-channel.mjs", import.meta.url).pathname;

function fixture({ localVersion, latest, canary, published = [] }) {
  const root = mkdtempSync(join(tmpdir(), "release-channel-test-"));
  mkdirSync(join(root, "packages", "server"), { recursive: true });
  mkdirSync(join(root, ".changeset"));
  writeFileSync(
    join(root, "packages", "server", "package.json"),
    JSON.stringify({ name: "mcp-use", version: localVersion })
  );
  writeFileSync(join(root, ".changeset", "README.md"), "# Changesets\n");
  const registry = {
    "mcp-use": {
      "dist-tags": { latest, canary },
      versions: Object.fromEntries(published.map((version) => [version, {}])),
    },
  };
  const registryFile = join(root, "registry.json");
  writeFileSync(registryFile, JSON.stringify(registry));
  return { root, registryFile };
}

function run(root, registryFile, ...args) {
  return spawnSync(
    process.execPath,
    [script, ...args, "--registry-file", registryFile],
    {
      cwd: root,
      encoding: "utf8",
    }
  );
}

test("rejects a stable source version below npm latest", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.1",
    latest: "2.0.4",
    canary: "2.0.2-canary.1",
    published: ["2.0.1", "2.0.4"],
  });
  const result = run(root, registryFile, "preflight", "--channel", "stable");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /2\.0\.1 is below npm latest 2\.0\.4/u);
});

test("accepts a canary release above npm latest", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.0",
    latest: "2.0.4",
    canary: "2.0.2-canary.1",
    published: ["2.0.4"],
  });
  const output = join(root, "plan.json");
  execFileSync(
    process.execPath,
    [
      script,
      "snapshot",
      "--channel",
      "canary",
      "--output",
      output,
      "--registry-file",
      registryFile,
    ],
    { cwd: root }
  );
  const plan = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(plan.releases[0].target, true);
});

test("ignores changesets already applied in prerelease mode", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.0",
    latest: "2.0.4",
    canary: "2.0.5-canary.0",
    published: ["2.0.4", "2.0.5-canary.0"],
  });
  writeFileSync(
    join(root, ".changeset", "done.md"),
    '---\n"mcp-use": patch\n---\n\nDone.\n'
  );
  writeFileSync(
    join(root, ".changeset", "pre.json"),
    JSON.stringify({
      mode: "pre",
      tag: "canary",
      initialVersions: { "mcp-use": "2.0.4" },
      changesets: ["done"],
    })
  );
  const result = run(root, registryFile, "pending");
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
});

test("registry verification accepts a completed target after a publish error", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.0",
    latest: "2.0.4",
    canary: "2.0.2-canary.1",
    published: ["2.0.4"],
  });
  const planFile = join(root, "plan.json");
  execFileSync(
    process.execPath,
    [
      script,
      "snapshot",
      "--channel",
      "canary",
      "--output",
      planFile,
      "--registry-file",
      registryFile,
    ],
    { cwd: root }
  );
  writeFileSync(
    registryFile,
    JSON.stringify({
      "mcp-use": {
        "dist-tags": { latest: "2.0.4", canary: "2.0.5-canary.0" },
        versions: { "2.0.4": {}, "2.0.5-canary.0": {} },
      },
    })
  );
  const result = run(root, registryFile, "verify", "--plan", planFile);
  assert.equal(result.status, 0, result.stderr);
});

test("registry verification rejects a missing target", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.0",
    latest: "2.0.4",
    canary: "2.0.2-canary.1",
    published: ["2.0.4"],
  });
  const planFile = join(root, "plan.json");
  execFileSync(
    process.execPath,
    [
      script,
      "snapshot",
      "--channel",
      "canary",
      "--output",
      planFile,
      "--registry-file",
      registryFile,
    ],
    { cwd: root }
  );
  const result = spawnSync(
    process.execPath,
    [script, "verify", "--plan", planFile, "--registry-file", registryFile],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VERIFY_ATTEMPTS: "1" },
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is missing from npm/u);
});

test("registry verification rejects an unrelated dist-tag change", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.0",
    latest: "2.0.4",
    canary: "2.0.2-canary.1",
    published: ["2.0.4"],
  });
  const planFile = join(root, "plan.json");
  execFileSync(
    process.execPath,
    [
      script,
      "snapshot",
      "--channel",
      "canary",
      "--output",
      planFile,
      "--registry-file",
      registryFile,
    ],
    { cwd: root }
  );
  writeFileSync(
    registryFile,
    JSON.stringify({
      "mcp-use": {
        "dist-tags": {
          latest: "2.0.3",
          canary: "2.0.5-canary.0",
        },
        versions: { "2.0.4": {}, "2.0.5-canary.0": {} },
      },
    })
  );
  const result = spawnSync(
    process.execPath,
    [script, "verify", "--plan", planFile, "--registry-file", registryFile],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VERIFY_ATTEMPTS: "1" },
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unrelated dist-tags changed/u);
});
