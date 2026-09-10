import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import {
  prepareRelease,
  packageEntries,
  metadataErrors,
} from "./release-propagation.mjs";

const require = createRequire(import.meta.url);
const cli = join(
  require.resolve("@changesets/cli/package.json"),
  "..",
  "bin.js"
);
const releaseScript = new URL("./release-channel.mjs", import.meta.url)
  .pathname;
const versionScript = new URL("./version-packages.mjs", import.meta.url)
  .pathname;
const config = JSON.parse(
  readFileSync(new URL("../.changeset/config.json", import.meta.url), "utf8")
);

function json(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function fixture(t, seed = "@mcp-use/agent", stale = true) {
  const root = mkdtempSync(join(tmpdir(), "propagation-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".changeset"));
  json(join(root, "package.json"), {
    name: "fixture",
    private: true,
    workspaces: ["packages/*"],
  });
  json(join(root, ".changeset/config.json"), { ...config, changelog: false });
  const manifests = [
    [
      "server",
      {
        name: "mcp-use",
        version: "2.5.0-canary.7",
        dependencies: {
          "@mcp-use/inspector": "workspace:*",
          "@mcp-use/cli": "workspace:*",
        },
      },
    ],
    [
      "inspector",
      {
        name: "@mcp-use/inspector",
        version: "20.3.8-canary.0",
        dependencies: {},
        peerDependencies: {
          "mcp-use": stale ? "^2.4.4-canary.0" : "^2.5.0-canary.0",
          "@mcp-use/agent": "^2.0.16-canary.0",
          "@mcp-use/client": "^2.3.1-canary.0",
        },
        peerDependenciesMeta: {
          "mcp-use": { optional: true },
          "@mcp-use/agent": { optional: true },
          "@mcp-use/client": { optional: true },
        },
        devDependencies: {
          "@mcp-use/agent": "workspace:*",
          "@mcp-use/client": "workspace:*",
        },
      },
    ],
    ["agent", { name: "@mcp-use/agent", version: "2.0.16-canary.4" }],
    ["client", { name: "@mcp-use/client", version: "2.3.1-canary.0" }],
    [
      "cli",
      {
        name: "@mcp-use/cli",
        version: "4.1.12-canary.3",
        devDependencies: { "@mcp-use/tunnel": "workspace:*" },
      },
    ],
    ["tunnel", { name: "@mcp-use/tunnel", version: "1.0.1-canary.0" }],
  ];
  for (const [dir, manifest] of manifests) {
    mkdirSync(join(root, "packages", dir), { recursive: true });
    json(join(root, "packages", dir, "package.json"), manifest);
  }
  json(join(root, ".changeset/pre.json"), {
    mode: "pre",
    tag: "canary",
    changesets: [],
    initialVersions: {
      "mcp-use": "2.4.3",
      "@mcp-use/inspector": "20.3.7",
      "@mcp-use/agent": "2.0.15",
      "@mcp-use/client": "2.3.0",
      "@mcp-use/cli": "4.1.11",
      "@mcp-use/tunnel": "1.0.0",
    },
  });
  writeFileSync(
    join(root, ".changeset/user-change.md"),
    `---\n"${seed}": patch\n---\n\nThe user's change.\n`
  );
  return root;
}
function version(root) {
  const result = spawnSync(process.execPath, [cli, "version"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const manifests = packageEntries(root).map(({ packageJson }) => packageJson);
  assert.deepEqual(metadataErrors(manifests), []);
  return new Map(manifests.map((pkg) => [pkg.name, pkg]));
}
function state(root) {
  return JSON.stringify([
    packageEntries(root),
    readdirSync(join(root, ".changeset"))
      .sort()
      .map((name) => [
        name,
        readFileSync(join(root, ".changeset", name), "utf8"),
      ]),
  ]);
}

for (const seed of ["@mcp-use/agent", "@mcp-use/client"]) {
  test(`${seed}-only changeset rebuilds Inspector and releases mcp-use without runtime dependencies`, async (t) => {
    const root = fixture(t, seed);
    await prepareRelease(root, "canary");
    const first = state(root);
    await prepareRelease(root, "canary");
    assert.equal(state(root), first, "preparation is idempotent");
    const packages = version(root);
    assert.notEqual(
      packages.get("@mcp-use/inspector").version,
      "20.3.8-canary.0"
    );
    assert.notEqual(packages.get("mcp-use").version, "2.5.0-canary.7");
    assert.deepEqual(packages.get("@mcp-use/inspector").dependencies, {});
    assert.equal(
      packages.get("@mcp-use/inspector").peerDependenciesMeta["mcp-use"]
        .optional,
      true
    );
    const applied = state(root);
    await prepareRelease(root, "canary");
    assert.equal(
      state(root),
      applied,
      "applied changesets do not retrigger releases"
    );
  });
}

test("a metadata-only repair releases Inspector even when no bundle input changed", async (t) => {
  const root = fixture(t, "mcp-use");
  await prepareRelease(root, "canary");
  const packages = version(root);
  assert.notEqual(
    packages.get("@mcp-use/inspector").version,
    "20.3.8-canary.0"
  );
  assert.equal(packages.get("@mcp-use/agent").version, "2.0.16-canary.4");
});

test("Tunnel rebuilds CLI and propagates its exact mcp-use dependency without an unrelated Inspector rebuild", async (t) => {
  const root = fixture(t, "@mcp-use/tunnel", false);
  await prepareRelease(root, "canary");
  const packages = version(root);
  assert.notEqual(packages.get("@mcp-use/cli").version, "4.1.12-canary.3");
  assert.notEqual(packages.get("mcp-use").version, "2.5.0-canary.7");
  assert.equal(packages.get("@mcp-use/inspector").version, "20.3.8-canary.0");
});

test("a canary minor crossing and explicit owner minor keep their requested versions", async (t) => {
  const root = fixture(t, "mcp-use", false);
  writeFileSync(
    join(root, ".changeset/user-change.md"),
    '---\n"mcp-use": minor\n"@mcp-use/inspector": minor\n---\n\nMinor changes.\n'
  );
  await prepareRelease(root, "canary");
  const packages = version(root);
  assert.match(
    packages.get("@mcp-use/inspector").version,
    /^20\.4\.0-canary\./
  );
  assert.match(packages.get("mcp-use").version, /^2\.5\.0-canary\./);
});

test("stable releases propagate bundle changes with independent version lines", async (t) => {
  const root = fixture(t, "@mcp-use/agent", false);
  rmSync(join(root, ".changeset/pre.json"));
  for (const { dir, packageJson } of packageEntries(root)) {
    packageJson.version = packageJson.version.split("-")[0];
    for (const [name, range] of Object.entries(
      packageJson.peerDependencies ?? {}
    ))
      packageJson.peerDependencies[name] = range.split("-")[0];
    json(join(dir, "package.json"), packageJson);
  }
  await prepareRelease(root, "stable");
  const packages = version(root);
  assert.equal(packages.get("@mcp-use/agent").version, "2.0.17");
  assert.equal(packages.get("@mcp-use/inspector").version, "20.3.9");
  assert.equal(packages.get("mcp-use").version, "2.5.1");
});

test("snapshot rejects changed metadata hidden under an already-published version", (t) => {
  const root = fixture(t);
  const registry = Object.fromEntries(
    packageEntries(root).map(({ packageJson: pkg }) => [
      pkg.name,
      {
        "dist-tags": { canary: pkg.version },
        versions: { [pkg.version]: pkg },
      },
    ])
  );
  const file = join(root, "packages/inspector/package.json");
  const inspector = JSON.parse(readFileSync(file, "utf8"));
  inspector.peerDependencies["mcp-use"] += " || ^2.5.0-canary.0";
  json(file, inspector);
  const registryFile = join(root, "registry.json");
  json(registryFile, registry);
  const result = spawnSync(
    process.execPath,
    [
      releaseScript,
      "snapshot",
      "--channel",
      "canary",
      "--registry-file",
      registryFile,
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /changed published metadata but no new version/);
});

test("normal npm prerelease semantics reject the reported peer mismatch", () => {
  assert.match(
    metadataErrors([
      { name: "mcp-use", version: "2.5.0-canary.7" },
      {
        name: "@mcp-use/inspector",
        version: "20.3.8-canary.0",
        peerDependencies: { "mcp-use": "^2.4.4-canary.0" },
      },
    ])[0],
    /rejects 2\.5\.0-canary\.7/
  );
});

test("Canary exit runs the production version wrapper and keeps stable peers compatible", async (t) => {
  const root = fixture(t, "@mcp-use/agent");
  await prepareRelease(root, "canary");
  version(root);
  const exit = spawnSync(process.execPath, [cli, "pre", "exit"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(exit.status, 0, exit.stderr);
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  symlinkSync(cli, join(root, "node_modules/.bin/changeset"));
  const result = spawnSync(process.execPath, [versionScript], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const manifests = packageEntries(root).map(({ packageJson }) => packageJson);
  assert.deepEqual(metadataErrors(manifests), []);
  assert.ok(manifests.every(({ version }) => !version.includes("canary")));
  assert.deepEqual(
    manifests.find(({ name }) => name === "@mcp-use/inspector").dependencies,
    {}
  );
});

test("moving mcp-use from the 2.4.4 Canary line to 2.5.0 republishes Inspector", async (t) => {
  const root = fixture(t, "mcp-use");
  const file = join(root, "packages/server/package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.version = "2.4.4-canary.5";
  json(file, manifest);
  writeFileSync(
    join(root, ".changeset/user-change.md"),
    '---\n"mcp-use": minor\n---\n\nNew API.\n'
  );
  await prepareRelease(root, "canary");
  const packages = version(root);
  assert.match(packages.get("mcp-use").version, /^2\.5\.0-canary\./);
  assert.notEqual(
    packages.get("@mcp-use/inspector").version,
    "20.3.8-canary.0"
  );
});
