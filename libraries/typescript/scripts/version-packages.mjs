import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import semver from "semver";

const workspaceRoot = process.cwd();
const changesetDirectory = join(workspaceRoot, ".changeset");
const packageDirectory = join(workspaceRoot, "packages");

function runChangeset(args) {
  const command = join(
    workspaceRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "changeset.cmd" : "changeset"
  );
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function packageManifests() {
  return readdirSync(packageDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packageDirectory, entry.name, "package.json"))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });
}

function basePeerRange(range) {
  const parts = range.split("||").map((part) => part.trim());
  const retained = parts.filter((part) => {
    const version = semver.valid(part);
    return version === null || semver.prerelease(version) === null;
  });
  return retained.join(" || ");
}

function stablePeerRange(range) {
  return range.replace(
    /([~^])(\d+\.\d+\.\d+)-(?:alpha|beta|canary)(?:\.[0-9A-Za-z.-]+)?/g,
    "$1$2"
  );
}

function normalizeInternalPeerRanges() {
  const manifests = packageManifests();
  const packages = new Map(
    manifests.map((file) => {
      const manifest = readJson(file);
      return [manifest.name, { file, manifest }];
    })
  );

  for (const { file, manifest } of packages.values()) {
    let changed = false;
    for (const [dependency, currentRange] of Object.entries(
      manifest.peerDependencies ?? {}
    )) {
      if (!packages.has(dependency)) continue;

      const baseRange = basePeerRange(currentRange);
      let desiredRange = stablePeerRange(baseRange);
      if (desiredRange === "") desiredRange = "workspace:*";

      if (desiredRange !== currentRange) {
        manifest.peerDependencies[dependency] = desiredRange;
        changed = true;
      }
    }
    if (changed) writeJson(file, manifest);
  }
}

const preFile = join(changesetDirectory, "pre.json");
let preState;
try {
  preState = readJson(preFile);
} catch {
  preState = undefined;
}

if (preState?.mode === "exit") {
  normalizeInternalPeerRanges();
}

runChangeset(["version"]);
