import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publicationOrder, publishPackages } from "./release-packages.mjs";

function release(name, dependencies = {}) {
  const directory = mkdtempSync(join(tmpdir(), "release-publisher-test-"));
  const artifact = join(directory, "package.tgz");
  writeFileSync(artifact, name);
  return {
    name,
    version: "1.0.1-canary.0",
    artifact,
    target: true,
    published: false,
    channelTag: "canary",
    integrity: createHash("sha512").update(name).digest("base64"),
    manifest: { name, version: "1.0.1-canary.0", dependencies },
  };
}

function recorder(releases, publish) {
  return (command, args) => {
    if (command === "tar")
      return JSON.stringify(
        releases.find((item) => item.artifact === args[1]).manifest
      );
    assert.equal(command, "npm");
    assert.equal(args[0], "publish");
    assert.ok(args.includes("--ignore-scripts"));
    assert.equal(args[args.indexOf("--tag") + 1], "canary");
    return publish(releases.find((item) => item.artifact === args[1]));
  };
}

test("publishes dependencies first and tolerates peer dependency cycles", () => {
  const client = release("@mcp-use/client");
  const server = release("mcp-use", { "@mcp-use/client": "1.0.1-canary.0" });
  client.manifest.peerDependencies = { "mcp-use": "*" };
  const releases = [server, client],
    names = [];
  publishPackages(
    { releases },
    recorder(releases, (item) => names.push(item.name))
  );
  assert.deepEqual(names, [client.name, server.name]);
});

test("rejects mutated tarballs before any package is published", () => {
  const releases = [release("client"), release("server")];
  writeFileSync(releases[1].artifact, "rebuild clobbered the verified files");
  const published = [];
  assert.throws(
    () =>
      publishPackages(
        { releases },
        recorder(releases, (item) => published.push(item))
      ),
    /Tarball changed/
  );
  assert.equal(published.length, 0);
});

test("stops after a failed dependency publish", () => {
  const releases = [release("server", { client: "*" }), release("client")];
  const attempted = [];
  assert.throws(
    () =>
      publishPackages(
        { releases },
        recorder(releases, (item) => {
          attempted.push(item.name);
          throw new Error("registry unavailable");
        })
      ),
    /registry unavailable/
  );
  assert.deepEqual(attempted, ["client"]);
});

test("recovery does not republish an immutable npm version", () => {
  const releases = [release("client"), release("server", { client: "*" })];
  releases[0].published = true;
  const published = [];
  publishPackages(
    { releases },
    recorder(releases, (item) => published.push(item.name))
  );
  assert.deepEqual(published, ["server"]);
});

test("rejects circular runtime dependencies", () => {
  assert.throws(
    () =>
      publicationOrder([
        { manifest: { name: "a", dependencies: { b: "*" } } },
        { manifest: { name: "b", optionalDependencies: { a: "*" } } },
      ]),
    /Circular release dependency/
  );
});

test("packing preserves client artifacts despite a destructive prepack hook", () => {
  const root = mkdtempSync(join(tmpdir(), "release-pack-hook-test-"));
  const packageDir = join(root, "packages", "client");
  mkdirSync(join(packageDir, "dist"), { recursive: true });
  writeFileSync(
    join(packageDir, "dist", "index.js"),
    "export const client = true;\n"
  );
  const manifest = JSON.stringify({
    name: "@test/client",
    version: "1.0.0",
    files: ["dist"],
    main: "./dist/index.js",
    scripts: {
      prepack: "node -e \"require('fs').rmSync('dist', {recursive:true})\"",
    },
  });
  writeFileSync(join(packageDir, "package.json"), manifest);
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "fixture"
  );
  const planFile = join(root, "plan.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      releases: [
        {
          name: "@test/client",
          version: "1.0.0",
          target: true,
          published: false,
        },
      ],
    })
  );
  execFileSync(
    process.execPath,
    [
      new URL("./release-packages.mjs", import.meta.url).pathname,
      "pack",
      planFile,
      join(root, "artifacts"),
    ],
    { cwd: root, stdio: "pipe" }
  );
  assert.equal(
    readFileSync(join(packageDir, "package.json"), "utf8"),
    manifest
  );
  assert.equal(
    readFileSync(join(packageDir, "dist", "index.js"), "utf8"),
    "export const client = true;\n"
  );
  const packed = JSON.parse(readFileSync(planFile, "utf8")).releases[0];
  const archiveManifest = JSON.parse(
    execFileSync("tar", ["-xOf", packed.artifact, "package/package.json"], {
      encoding: "utf8",
    })
  );
  assert.equal(
    archiveManifest.gitHead,
    git("rev-parse", "HEAD").toString().trim()
  );
  assert.ok(packed.integrity);
});

test("an interrupted release cannot publish later unversioned source changes", () => {
  const root = mkdtempSync(join(tmpdir(), "release-source-test-"));
  mkdirSync(join(root, "packages", "client"), { recursive: true });
  const manifest = join(root, "packages", "client", "package.json");
  writeFileSync(
    manifest,
    JSON.stringify({ name: "@test/client", version: "1.0.0" }, null, 2)
  );
  const source = join(root, "packages", "client", "index.js");
  writeFileSync(source, "export const original = true;\n");
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "version packages"
  );
  const planFile = join(root, "plan.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      releases: [
        {
          name: "@test/client",
          version: "1.0.0",
          target: true,
          published: false,
        },
      ],
    })
  );
  const args = [
    new URL("./release-packages.mjs", import.meta.url).pathname,
    "assert-source",
    planFile,
  ];
  execFileSync(process.execPath, args, { cwd: root, stdio: "pipe" });
  writeFileSync(source, "export const unrelatedLaterFeature = true;\n");
  git("add", "packages");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "unversioned change"
  );
  assert.throws(
    () => execFileSync(process.execPath, args, { cwd: root, stdio: "pipe" }),
    /Package source changed/
  );
});
