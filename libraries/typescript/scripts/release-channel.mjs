import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import semver from "semver";

const workspaceRoot = process.cwd();
const packageRoot = join(workspaceRoot, "packages");
const preFile = join(workspaceRoot, ".changeset", "pre.json");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function manifests() {
  return readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packageRoot, entry.name, "package.json"))
    .map(readJson)
    .filter(
      (manifest) => !manifest.private && manifest.name && manifest.version
    );
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

function packageNamesForChangesets(ids) {
  const names = new Set();
  for (const id of ids) {
    const contents = readFileSync(
      join(workspaceRoot, ".changeset", `${id}.md`),
      "utf8"
    );
    const frontmatter = contents.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
    for (const line of frontmatter.split("\n")) {
      const match = line.match(
        /^\s*["']?([^"']+?)["']?\s*:\s*(?:patch|minor|major)\s*$/u
      );
      if (match) names.add(match[1]);
    }
  }
  return names;
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

async function snapshot(channel, output) {
  const tag = channel === "stable" ? "latest" : "canary";
  const releases = [];

  for (const manifest of manifests()) {
    const metadata = await registryMetadata(manifest.name);
    const versions = metadata.versions ?? {};
    const distTags = metadata["dist-tags"] ?? {};
    const published = Object.hasOwn(versions, manifest.version);
    const latest = distTags.latest;

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
    }

    releases.push({
      name: manifest.name,
      version: manifest.version,
      target: !published,
      channelTag: tag,
      distTagsBefore: distTags,
    });
  }

  const plan = { channel, releases };
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(
    `Wrote ${channel} release plan with ${releases.filter((item) => item.target).length} target(s) to ${output}`
  );
}

async function verifyOnce(plan) {
  const errors = [];
  for (const release of plan.releases) {
    const metadata = await registryMetadata(release.name);
    const versions = metadata.versions ?? {};
    const afterTags = metadata["dist-tags"] ?? {};

    if (release.target) {
      if (!Object.hasOwn(versions, release.version)) {
        errors.push(`${release.name}@${release.version} is missing from npm`);
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
