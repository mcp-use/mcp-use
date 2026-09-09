import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  packedArtifactErrors,
  packedFilesFromNpmPackJson,
  requiredPackedEntries,
} from "./release-artifact.mjs";

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

function writeChangeset(root, id, releases, summary = "Test change.") {
  const frontmatter = releases
    .map(({ name, type }) => `"${name}": ${type}`)
    .join("\n");
  writeFileSync(
    join(root, ".changeset", `${id}.md`),
    `---\n${frontmatter}\n---\n\n${summary}\n`
  );
}

function writePreState(root, initialVersions, changesets = []) {
  writeFileSync(
    join(root, ".changeset", "pre.json"),
    JSON.stringify({
      mode: "pre",
      tag: "canary",
      initialVersions,
      changesets,
    })
  );
}

test("requires declared package files and entry points in packed artifacts", () => {
  const manifest = {
    name: "@mcp-use/client",
    files: ["dist"],
    module: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        node: { import: "./dist/index.js", types: "./dist/index.d.ts" },
        browser: {
          import: "./dist/index-browser.js",
          types: "./dist/index-browser.d.ts",
        },
      },
      "./react": {
        import: "./dist/react/index.js",
        types: "./dist/react/index.d.ts",
      },
    },
  };

  assert.deepEqual(requiredPackedEntries(manifest), {
    exact: [
      "dist/index-browser.d.ts",
      "dist/index-browser.js",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/react/index.d.ts",
      "dist/react/index.js",
    ],
    prefixes: ["dist"],
  });
  assert.deepEqual(
    packedArtifactErrors(manifest, [
      { path: "README.md" },
      { path: "package.json" },
    ]),
    [
      "missing entry point dist/index-browser.d.ts",
      "missing entry point dist/index-browser.js",
      "missing entry point dist/index.d.ts",
      "missing entry point dist/index.js",
      "missing entry point dist/react/index.d.ts",
      "missing entry point dist/react/index.js",
      "files entry dist matched no packed files",
    ]
  );
  assert.deepEqual(
    packedArtifactErrors(
      manifest,
      requiredPackedEntries(manifest).exact.map((path) => ({ path }))
    ),
    []
  );
});

test("accepts npm pack array, direct object, and package-keyed JSON", () => {
  const packed = { files: [{ path: "package.json" }] };
  assert.deepEqual(
    packedFilesFromNpmPackJson(JSON.stringify([packed])),
    packed.files
  );
  assert.deepEqual(
    packedFilesFromNpmPackJson(JSON.stringify(packed)),
    packed.files
  );
  assert.deepEqual(
    packedFilesFromNpmPackJson(JSON.stringify({ "@mcp-use/client": packed })),
    packed.files
  );
});

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

test("rejects an unpublished Canary version below the current Canary tag", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.1.0-canary.0",
    latest: "2.0.4",
    canary: "2.1.0-canary.4",
    published: ["2.0.4", "2.1.0-canary.4"],
  });
  const result = run(
    root,
    registryFile,
    "snapshot",
    "--channel",
    "canary",
    "--output",
    join(root, "plan.json")
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /2\.1\.0-canary\.0 must be greater than npm canary 2\.1\.0-canary\.4/u
  );
});

test("allows stable promotion below an unrelated historical Canary major", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.1.0",
    latest: "2.0.4",
    canary: "2.1.0-canary.7",
    published: ["2.0.4", "2.1.0-canary.7", "3.0.0-canary.11"],
  });
  const result = run(root, registryFile, "preflight", "--channel", "stable");
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    /historical Canary versions: 3\.0\.0-canary\.11/u
  );
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

test("prepares internal peer ranges for pending Canary changes", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.4",
    latest: "2.0.4",
    canary: "2.0.5-canary.6",
    published: ["2.0.4", "2.0.5-canary.6"],
  });
  mkdirSync(join(root, "packages", "client"), { recursive: true });
  mkdirSync(join(root, "packages", "agent"), { recursive: true });
  mkdirSync(join(root, "packages", "inspector"), { recursive: true });
  writeFileSync(
    join(root, "packages", "client", "package.json"),
    JSON.stringify({
      name: "@mcp-use/client",
      version: "2.0.1",
      peerDependencies: { "mcp-use": "workspace:*" },
    })
  );
  writeFileSync(
    join(root, "packages", "server", "package.json"),
    JSON.stringify({
      name: "mcp-use",
      version: "2.0.5-canary.6",
      peerDependencies: { "@mcp-use/client": "^2.0.1" },
    })
  );
  writeFileSync(
    join(root, "packages", "agent", "package.json"),
    JSON.stringify({ name: "@mcp-use/agent", version: "2.0.2-canary.4" })
  );
  writeFileSync(
    join(root, "packages", "inspector", "package.json"),
    JSON.stringify({
      name: "@mcp-use/inspector",
      version: "20.0.5-canary.6",
      peerDependencies: { "@mcp-use/agent": "^2.0.1" },
    })
  );
  writeChangeset(root, "skills", [
    { name: "@mcp-use/agent", type: "patch" },
    { name: "@mcp-use/client", type: "minor" },
    { name: "mcp-use", type: "minor" },
  ]);
  writePreState(root, {
    "@mcp-use/agent": "2.0.1",
    "@mcp-use/client": "2.0.1",
    "@mcp-use/inspector": "20.0.4",
    "mcp-use": "2.0.4",
  });

  const result = run(root, registryFile, "prepare", "--channel", "canary");
  assert.equal(result.status, 0, result.stderr);
  const server = JSON.parse(
    readFileSync(join(root, "packages", "server", "package.json"), "utf8")
  );
  assert.equal(
    server.peerDependencies["@mcp-use/client"],
    "^2.0.1 || ^2.1.0-canary.0"
  );
  const client = JSON.parse(
    readFileSync(join(root, "packages", "client", "package.json"), "utf8")
  );
  assert.equal(
    client.peerDependencies["mcp-use"],
    "^2.0.4 || ^2.0.5-canary.0 || ^2.1.0-canary.0"
  );
  const inspector = JSON.parse(
    readFileSync(join(root, "packages", "inspector", "package.json"), "utf8")
  );
  assert.equal(
    inspector.peerDependencies["@mcp-use/agent"],
    "^2.0.1 || ^2.0.2-canary.0"
  );

  const repeated = run(root, registryFile, "prepare", "--channel", "canary");
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(
    readFileSync(join(root, "packages", "client", "package.json"), "utf8"),
    `${JSON.stringify(client, null, 2)}\n`
  );
});

test("rejects the accidental mcp-use, CLI, and Inspector Canary majors", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.6",
    latest: "2.0.4",
    canary: "2.0.5-canary.6",
    published: ["2.0.4", "2.0.5-canary.6"],
  });
  const planFile = join(root, "changeset-status.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      changesets: [
        {
          id: "skills",
          releases: [
            { name: "mcp-use", type: "minor" },
            { name: "@mcp-use/cli", type: "minor" },
            { name: "@mcp-use/inspector", type: "minor" },
          ],
        },
      ],
      releases: [
        {
          name: "mcp-use",
          type: "major",
          oldVersion: "2.0.5-canary.6",
          newVersion: "3.0.0-canary.7",
        },
        {
          name: "@mcp-use/cli",
          type: "major",
          oldVersion: "4.0.2-canary.5",
          newVersion: "5.0.0-canary.6",
        },
        {
          name: "@mcp-use/inspector",
          type: "major",
          oldVersion: "20.0.5-canary.6",
          newVersion: "21.0.0-canary.7",
        },
      ],
      preState: { mode: "pre", tag: "canary" },
    })
  );

  const result = run(
    root,
    registryFile,
    "validate",
    "--channel",
    "canary",
    "--plan",
    planFile
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /mcp-use would cross a major boundary .* without an explicit major changeset/u
  );
  assert.match(
    result.stderr,
    /@mcp-use\/cli would cross a major boundary .* without an explicit major changeset/u
  );
  assert.match(
    result.stderr,
    /@mcp-use\/inspector would cross a major boundary .* without an explicit major changeset/u
  );
});

test("accepts a Canary major with an explicit major changeset", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.6",
    latest: "2.0.4",
    canary: "2.0.5-canary.6",
    published: ["2.0.4", "2.0.5-canary.6"],
  });
  const planFile = join(root, "changeset-status.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      changesets: [
        {
          id: "v3",
          releases: [{ name: "mcp-use", type: "major" }],
        },
      ],
      releases: [
        {
          name: "mcp-use",
          type: "major",
          oldVersion: "2.0.5-canary.6",
          newVersion: "3.0.0-canary.7",
        },
      ],
      preState: { mode: "pre", tag: "canary" },
    })
  );

  const result = run(
    root,
    registryFile,
    "validate",
    "--channel",
    "canary",
    "--plan",
    planFile
  );
  assert.equal(result.status, 0, result.stderr);
});

test("ignores unchanged packages in a Canary release plan", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.4",
    latest: "2.0.4",
    canary: "2.0.4-canary.0",
    published: ["2.0.4"],
  });
  const planFile = join(root, "changeset-status.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      changesets: [
        {
          id: "client-fix",
          releases: [{ name: "@mcp-use/client", type: "patch" }],
        },
      ],
      releases: [
        {
          name: "@mcp-use/client",
          type: "patch",
          oldVersion: "2.2.4",
          newVersion: "2.2.5-canary.0",
        },
        {
          name: "@mcp-use/cli",
          type: "none",
          oldVersion: "4.1.10",
          newVersion: "4.1.10",
        },
      ],
      preState: { mode: "pre", tag: "canary" },
    })
  );

  const result = run(
    root,
    registryFile,
    "validate",
    "--channel",
    "canary",
    "--plan",
    planFile
  );
  assert.equal(result.status, 0, result.stderr);
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

test("recovers a published canary without a git tag using npm's source revision", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.0",
    latest: "2.0.4",
    canary: "2.0.5-canary.0",
    published: ["2.0.5-canary.0"],
  });
  const metadata = JSON.parse(readFileSync(registryFile, "utf8"));
  const sourceSha = "a".repeat(40);
  metadata["mcp-use"].versions["2.0.5-canary.0"].gitHead = sourceSha;
  writeFileSync(registryFile, JSON.stringify(metadata));
  const planFile = join(root, "plan.json");
  const result = run(
    root,
    registryFile,
    "snapshot",
    "--channel",
    "canary",
    "--recover-tags",
    "true",
    "--output",
    planFile
  );
  assert.equal(result.status, 0, result.stderr);
  const recovered = JSON.parse(readFileSync(planFile, "utf8")).releases[0];
  assert.equal(recovered.target, true);
  assert.equal(recovered.published, true);
  assert.equal(recovered.sourceSha, sourceSha);
});

test("does not invent a source revision for recovery", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.0",
    latest: "2.0.4",
    canary: "2.0.5-canary.0",
    published: ["2.0.5-canary.0"],
  });
  const result = run(
    root,
    registryFile,
    "snapshot",
    "--channel",
    "canary",
    "--recover-tags",
    "true"
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm has no source gitHead/);
});

test("rejects a different npm tarball even when its version and tag match", () => {
  const { root, registryFile } = fixture({
    localVersion: "2.0.5-canary.0",
    latest: "2.0.4",
    canary: "2.0.5-canary.0",
    published: ["2.0.5-canary.0"],
  });
  const planFile = join(root, "plan.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      releases: [
        {
          name: "mcp-use",
          version: "2.0.5-canary.0",
          target: true,
          published: false,
          channelTag: "canary",
          integrity: "expected-hash",
          distTagsBefore: { latest: "2.0.4", canary: "2.0.5-canary.0" },
        },
      ],
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
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tarball integrity differs/);
});
