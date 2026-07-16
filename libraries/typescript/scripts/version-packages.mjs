import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

function normalizedWorkspaceRange(range, dependencyVersion) {
  if (!range.startsWith("workspace:")) return range;
  const workspaceRange = range.slice("workspace:".length);
  if (workspaceRange === "*") return dependencyVersion;
  if (workspaceRange === "^" || workspaceRange === "~") {
    return `${workspaceRange}${dependencyVersion}`;
  }
  return workspaceRange;
}

function updateInternalPeerRanges(releases, mode) {
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
      const internalDependency = packages.get(dependency);
      if (!internalDependency) continue;

      const baseRange = basePeerRange(currentRange);
      let desiredRange = baseRange;
      const release = releases.get(dependency);

      if (mode === "pre" && release && semver.prerelease(release.newVersion)) {
        const parsed = semver.parse(release.newVersion);
        const stableTarget = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
        const comparableRange = normalizedWorkspaceRange(
          baseRange,
          internalDependency.manifest.version
        );
        if (
          semver.satisfies(stableTarget, comparableRange) &&
          !semver.satisfies(release.newVersion, comparableRange)
        ) {
          desiredRange = `${baseRange} || ${release.newVersion}`;
        }
      }

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

if (preState?.mode === "pre") {
  let planFile = process.env.CHANGESETS_RELEASE_PLAN_PATH;
  let temporaryDirectory;
  if (!planFile) {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "mcp-use-release-plan-"));
    planFile = join(temporaryDirectory, "plan.json");
    runChangeset(["status", "--output", planFile]);
  }
  try {
    const plan = readJson(planFile);
    updateInternalPeerRanges(
      new Map(plan.releases.map((release) => [release.name, release])),
      "pre"
    );
  } finally {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true });
  }
} else if (preState?.mode === "exit") {
  updateInternalPeerRanges(new Map(), "exit");
}

runChangeset(["version"]);
