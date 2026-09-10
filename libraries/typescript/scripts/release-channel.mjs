import { spawnSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import semver from "semver";
import {
  prepareRelease,
  internalMetadata,
  metadataErrors,
} from "./release-propagation.mjs";

import {
  packedArtifactErrors,
  packedFilesFromNpmPackJson,
} from "./release-artifact.mjs";

const workspaceRoot = process.cwd();
const packageRoot = join(workspaceRoot, "packages");
const preFile = join(workspaceRoot, ".changeset", "pre.json");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function manifestEntries() {
  return readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packageRoot, entry.name, "package.json"))
    .map((file) => ({ file, manifest: readJson(file) }))
    .filter(({ manifest }) =>
      Boolean(!manifest.private && manifest.name && manifest.version)
    );
}

function manifests() {
  return manifestEntries().map(({ manifest }) => manifest);
}

function packedFiles(name, version) {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--ignore-scripts", "--json", `${name}@${version}`],
    { cwd: workspaceRoot, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `could not inspect ${name}@${version}: ${result.stderr || result.stdout}`
    );
  }
  try {
    return packedFilesFromNpmPackJson(result.stdout);
  } catch (error) {
    throw new Error(
      `could not parse npm pack file list for ${name}@${version}: ${error.message}`
    );
  }
}

function verifyPackedArtifact(release) {
  const manifest = manifests().find(({ name }) => name === release.name);
  if (!manifest) throw new Error(`No local manifest for ${release.name}`);
  const errors = packedArtifactErrors(
    manifest,
    packedFiles(release.name, release.version)
  );
  if (errors.length) {
    throw new Error(
      `${release.name}@${release.version} has an invalid npm artifact: ${errors.join(
        ", "
      )}`
    );
  }
}

function prereleaseState() {
  try {
    return readJson(preFile);
  } catch {
    return undefined;
  }
}

function pendingChangesets() {
  const applied = new Set(prereleaseState()?.changesets ?? []);
  return readdirSync(join(workspaceRoot, ".changeset"))
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .map((file) => file.slice(0, -3))
    .filter((id) => !applied.has(id))
    .sort();
}

const releaseTypePriority = { patch: 1, minor: 2, major: 3 };

function releasesForChangesets(ids) {
  const releases = [];
  for (const id of ids) {
    const contents = readFileSync(
      join(workspaceRoot, ".changeset", `${id}.md`),
      "utf8"
    );
    const frontmatter = contents.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
    for (const line of frontmatter.split("\n")) {
      const match = line.match(
        /^\s*["']?([^"']+?)["']?\s*:\s*(patch|minor|major)\s*$/u
      );
      if (match) releases.push({ name: match[1], type: match[2] });
    }
  }
  return releases;
}

function highestReleaseTypes(releases) {
  const types = new Map();
  for (const release of releases) {
    const current = types.get(release.name);
    if (
      current === undefined ||
      releaseTypePriority[release.type] > releaseTypePriority[current]
    ) {
      types.set(release.name, release.type);
    }
  }
  return types;
}

function packageNamesForChangesets(ids) {
  return new Set(releasesForChangesets(ids).map(({ name }) => name));
}

function validateReleasePlan(channel, planFile) {
  const plan = readJson(planFile);
  if (channel !== "canary") {
    throw new Error("Release-plan validation is only supported for canary");
  }
  if (plan.preState?.mode !== "pre" || plan.preState.tag !== "canary") {
    throw new Error("Canary release plan is not in canary prerelease mode");
  }

  const directTypes = highestReleaseTypes(
    (plan.changesets ?? []).flatMap((changeset) => changeset.releases ?? [])
  );
  const errors = [];

  for (const release of plan.releases ?? []) {
    if (release.type === "none") continue;
    const plannedMajor =
      release.type === "major" ||
      semver.major(release.newVersion) > semver.major(release.oldVersion);
    if (plannedMajor && directTypes.get(release.name) !== "major") {
      errors.push(
        `${release.name} would cross a major boundary (${release.oldVersion} -> ${release.newVersion}) without an explicit major changeset`
      );
    }
    if (semver.prerelease(release.newVersion)?.[0] !== "canary") {
      errors.push(
        `${release.name}@${release.newVersion} is not a Canary prerelease`
      );
    }
  }

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Validated Canary release plan with ${(plan.releases ?? []).length} release(s)`
  );
}

async function registryMetadata(name) {
  const fixture = option("--registry-file");
  if (fixture) {
    const metadata = readJson(fixture)[name];
    if (!metadata) throw new Error(`Registry fixture has no entry for ${name}`);
    return metadata;
  }

  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}?cache=${Date.now()}`;
  const response = await fetch(url, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`npm registry returned ${response.status} for ${name}`);
  return response.json();
}

function compareOrThrow(version, latest, message) {
  if (latest && semver.lt(version, latest)) {
    throw new Error(`${message}: ${version} is below npm latest ${latest}`);
  }
}

function historicalCanaryVersions(metadata, baseline) {
  return Object.keys(metadata.versions ?? {})
    .filter((version) => semver.prerelease(version)?.[0] === "canary")
    .filter((version) => semver.gt(version, baseline))
    .sort(semver.rcompare);
}

async function preflight(channel) {
  const pre = prereleaseState();
  const pending = pendingChangesets();
  const affected = packageNamesForChangesets(pending);

  if (channel === "canary" && (pre?.mode !== "pre" || pre?.tag !== "canary")) {
    throw new Error(
      "Canary verification requires .changeset/pre.json in canary prerelease mode"
    );
  }

  for (const manifest of manifests()) {
    if (channel === "canary" && !affected.has(manifest.name)) continue;
    const metadata = await registryMetadata(manifest.name);
    const latest = metadata["dist-tags"]?.latest;
    const baseline = pre?.initialVersions?.[manifest.name] ?? manifest.version;
    compareOrThrow(baseline, latest, `${manifest.name} ${channel} baseline`);

    if (channel === "stable") {
      const historical = historicalCanaryVersions(metadata, baseline);
      if (historical.length) {
        console.warn(
          `${manifest.name} stable promotion is below historical Canary versions: ${historical.join(", ")}`
        );
      }
    }
  }

  console.log(
    `Release-channel preflight passed for ${channel} (${pending.length} pending changeset(s))`
  );
}

function sameJson(left, right) {
  const sortedEntries = (value) =>
    Object.entries(value ?? {}).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    );
  return (
    JSON.stringify(sortedEntries(left)) === JSON.stringify(sortedEntries(right))
  );
}

function sameMetadata(left, right) {
  return ["dependencies", "optionalDependencies", "peerDependencies"].every(
    (field) => sameJson(left[field], right[field])
  );
}

function packManifest(entry) {
  const scratch = mkdtempSync(join(tmpdir(), "release-manifest-"));
  try {
    const result = spawnSync(
      "pnpm",
      ["pack", "--pack-destination", scratch, "--json"],
      {
        cwd: join(entry.file, ".."),
        encoding: "utf8",
        env: { ...process.env, npm_config_ignore_scripts: "true" },
      }
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    const tarballs = readdirSync(scratch).filter((file) =>
      file.endsWith(".tgz")
    );
    if (tarballs.length !== 1)
      throw new Error(
        `Expected one packed artifact for ${entry.manifest.name}`
      );
    const manifest = spawnSync(
      "tar",
      ["-xOf", join(scratch, tarballs[0]), "package/package.json"],
      { encoding: "utf8" }
    );
    if (manifest.status !== 0) throw new Error(manifest.stderr);
    return JSON.parse(manifest.stdout);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function snapshot(channel, output) {
  const tag = channel === "stable" ? "latest" : "canary";
  const releases = [];
  const entries = manifestEntries();
  const versionsInPlan = new Map(
    entries.map(({ manifest }) => [manifest.name, manifest.version])
  );
  const effective = [];

  for (const entry of entries) {
    const manifest = option("--registry-file")
      ? entry.manifest
      : packManifest(entry);
    const metadata = await registryMetadata(manifest.name);
    const versions = metadata.versions ?? {};
    const distTags = metadata["dist-tags"] ?? {};
    const published = Object.hasOwn(versions, manifest.version);
    const latest = distTags.latest;
    const expectedMetadata = internalMetadata(manifest, versionsInPlan);
    const publishedManifest = versions[manifest.version];
    if (
      published &&
      !sameMetadata(
        expectedMetadata,
        internalMetadata(publishedManifest, versionsInPlan)
      )
    ) {
      throw new Error(
        `${manifest.name}@${manifest.version} has changed published metadata but no new version; release this package`
      );
    }
    effective.push(
      published
        ? {
            ...publishedManifest,
            name: manifest.name,
            version: manifest.version,
          }
        : manifest
    );

    if (!published) {
      if (channel === "stable" && semver.prerelease(manifest.version)) {
        throw new Error(
          `${manifest.name}@${manifest.version} is not a stable version`
        );
      }
      if (
        channel === "canary" &&
        semver.prerelease(manifest.version)?.[0] !== "canary"
      ) {
        throw new Error(
          `${manifest.name}@${manifest.version} is not a canary version`
        );
      }
      if (latest && !semver.gt(manifest.version, latest)) {
        throw new Error(
          `${manifest.name}@${manifest.version} must be greater than npm latest ${latest}`
        );
      }
      if (
        channel === "canary" &&
        distTags.canary &&
        !semver.gt(manifest.version, distTags.canary)
      ) {
        throw new Error(
          `${manifest.name}@${manifest.version} must be greater than npm canary ${distTags.canary}`
        );
      }
    }

    releases.push({
      name: manifest.name,
      version: manifest.version,
      target: !published,
      channelTag: tag,
      distTagsBefore: distTags,
      expectedMetadata,
    });
  }

  const errors = metadataErrors(effective);
  if (errors.length) throw new Error(errors.join("\n"));

  const plan = { channel, releases };
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(
    `Wrote ${channel} release plan with ${releases.filter((item) => item.target).length} target(s) to ${output}`
  );
}

async function verifyOnce(plan) {
  const errors = [];
  const versionsInPlan = new Map(
    plan.releases.map((release) => [release.name, release.version])
  );
  const effective = [];
  for (const release of plan.releases) {
    const metadata = await registryMetadata(release.name);
    const versions = metadata.versions ?? {};
    const afterTags = metadata["dist-tags"] ?? {};
    const published = versions[release.version];
    if (published) {
      effective.push({
        ...published,
        name: release.name,
        version: release.version,
      });
      if (
        release.expectedMetadata &&
        !sameMetadata(
          release.expectedMetadata,
          internalMetadata(published, versionsInPlan)
        )
      ) {
        errors.push(
          `${release.name}@${release.version} published metadata differs from the verified release plan`
        );
      }
    }

    if (release.target) {
      if (!Object.hasOwn(versions, release.version)) {
        errors.push(`${release.name}@${release.version} is missing from npm`);
      } else if (!option("--registry-file")) {
        try {
          verifyPackedArtifact(release);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (afterTags[release.channelTag] !== release.version) {
        errors.push(
          `${release.name} ${release.channelTag} is ${afterTags[release.channelTag] ?? "missing"}, expected ${release.version}`
        );
      }
      const beforeWithoutChannel = { ...release.distTagsBefore };
      const afterWithoutChannel = { ...afterTags };
      delete beforeWithoutChannel[release.channelTag];
      delete afterWithoutChannel[release.channelTag];
      if (!sameJson(beforeWithoutChannel, afterWithoutChannel)) {
        errors.push(`${release.name} unrelated dist-tags changed`);
      }
    } else if (!sameJson(release.distTagsBefore, afterTags)) {
      errors.push(
        `${release.name} dist-tags changed despite not being in the release plan`
      );
    }
  }
  errors.push(...metadataErrors(effective));
  if (errors.length) throw new Error(errors.join("\n"));
}

async function verify(planFile) {
  const plan = readJson(planFile);
  const attempts = Number(process.env.VERIFY_ATTEMPTS ?? 12);
  const delaySeconds = Number(process.env.VERIFY_DELAY_SECONDS ?? 10);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await verifyOnce(plan);
      console.log(`Verified npm registry on attempt ${attempt}/${attempts}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(
          `${error.message}\nRetrying registry verification (${attempt}/${attempts})`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, delaySeconds * 1000)
        );
      }
    }
  }
  throw lastError;
}

function writeTags(planFile, output) {
  const plan = readJson(planFile);
  const tags = plan.releases
    .filter((release) => release.target)
    .map((release) => `${release.name}@${release.version}`);
  writeFileSync(output, tags.length ? `${tags.join("\n")}\n` : "");
  console.log(tags.join("\n"));
}

const [command] = process.argv.slice(2);

try {
  if (command === "pending") {
    console.log(pendingChangesets().join("\n"));
  } else if (command === "prepare") {
    await prepareRelease(workspaceRoot, option("--channel"));
  } else if (command === "validate") {
    validateReleasePlan(
      option("--channel"),
      option("--plan", "changeset-status.json")
    );
  } else if (command === "preflight") {
    await preflight(option("--channel"));
  } else if (command === "snapshot") {
    await snapshot(
      option("--channel"),
      option("--output", "release-plan.json")
    );
  } else if (command === "verify") {
    await verify(option("--plan", "release-plan.json"));
  } else if (command === "tags") {
    writeTags(
      option("--plan", "release-plan.json"),
      option("--output", ".release-tags")
    );
  } else {
    throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
