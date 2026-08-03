import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import semver from "semver";

const root = process.cwd();
const packageRoot = join(root, "packages");
const targets = [
  {
    directory: "client",
    name: "@mcp-use/client",
    initial: "2.0.0-beta.0",
    bootstrap: true,
  },
  {
    directory: "agent",
    name: "@mcp-use/agent",
    initial: "2.0.0-beta.0",
    bootstrap: true,
  },
  {
    directory: "inspector",
    name: "@mcp-use/inspector",
    initial: "20.0.0-beta.0",
  },
  { directory: "cli", name: "@mcp-use/cli", initial: "4.0.0-beta.0" },
  // Publish the framework only after both regular dependencies are available.
  { directory: "server", name: "mcp-use", initial: "2.0.0-beta.0" },
  {
    directory: "create-mcp-use-app",
    name: "create-mcp-use-app",
    initial: "2.0.0-beta.0",
  },
];
function fail(message) {
  throw new Error(`[beta-release] ${message}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function validateDependency(name, range) {
  if (range.startsWith("workspace:")) return;
  if (/^(?:https?:|git(?:\+|:)|github:|file:|link:)/.test(range)) {
    fail(`${name} uses a non-registry dependency: ${range}`);
  }
}

function nonBetaDistTags(registry) {
  return Object.fromEntries(
    Object.entries(registry?.["dist-tags"] ?? {})
      .filter(([tag]) => tag !== "beta")
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

const preState = readJson(join(root, ".changeset", "pre.json"));
if (preState.mode !== "pre" || preState.tag !== "beta") {
  fail(
    `expected Changesets beta prerelease mode, received ${JSON.stringify({ mode: preState.mode, tag: preState.tag })}`
  );
}

const manifests = targets.map((target) => ({
  ...target,
  manifest: readJson(join(packageRoot, target.directory, "package.json")),
}));
const publicPackages = readdirSync(packageRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packageRoot, entry.name, "package.json"))
  .filter((file) => existsSync(file))
  .map((file) => readJson(file))
  .filter((manifest) => manifest.private !== true)
  .map((manifest) => manifest.name)
  .sort();
const expectedPackages = targets.map(({ name }) => name).sort();
if (JSON.stringify(publicPackages) !== JSON.stringify(expectedPackages)) {
  fail(
    `publishable workspace packages differ from the beta allowlist: ${JSON.stringify(publicPackages)}`
  );
}

for (const { name, manifest } of manifests) {
  if (manifest.name !== name)
    fail(`${name} does not match its package manifest name ${manifest.name}`);
  const parsed = semver.parse(manifest.version);
  if (
    !parsed ||
    parsed.prerelease[0] !== "beta" ||
    !Number.isInteger(parsed.prerelease[1])
  ) {
    fail(`${name}@${manifest.version} is not an x.y.z-beta.N version`);
  }
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
      validateDependency(`${name} ${field}.${dependency}`, range);
    }
  }
}

async function registryMetadata(name) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    {
      headers: { accept: "application/vnd.npm.install-v1+json" },
    }
  );
  if (response.status === 404) return undefined;
  if (!response.ok)
    fail(`npm registry returned ${response.status} for ${name}`);
  return response.json();
}

const metadata = new Map();
for (const { name } of targets)
  metadata.set(name, await registryMetadata(name));

const initialPublished = manifests.filter(
  ({ initial, name }) => metadata.get(name)?.versions?.[initial]
).length;
if (initialPublished !== targets.length) {
  for (const { initial, manifest, name } of manifests) {
    if (manifest.version !== initial) {
      fail(
        `initial beta train is incomplete, so ${name} must be ${initial}; found ${manifest.version}`
      );
    }
  }
}

const releases = manifests.map(({ bootstrap, manifest, name }) => {
  const registry = metadata.get(name);
  const betaTag = registry?.["dist-tags"]?.beta;
  const published = registry?.versions?.[manifest.version] !== undefined;
  if (!published && betaTag && !semver.gt(manifest.version, betaTag)) {
    fail(
      `${name}@${manifest.version} would not advance the current beta tag ${betaTag}`
    );
  }
  if (!registry && !bootstrap)
    fail(`${name} unexpectedly does not exist on npm`);
  return {
    name,
    version: manifest.version,
    published,
    bootstrap: !registry,
    latestBefore: registry?.["dist-tags"]?.latest ?? null,
    betaBefore: betaTag ?? null,
    nonBetaTagsBefore: nonBetaDistTags(registry),
  };
});

const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1)
  writeFileSync(
    process.argv[outputIndex + 1],
    `${JSON.stringify({ releases }, null, 2)}\n`
  );
console.log(JSON.stringify({ releases }, null, 2));
