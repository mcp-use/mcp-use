import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  packedArtifactErrors,
  packedFilesFromNpmPackJson,
} from "./release-artifact.mjs";

export function publicationOrder(entries) {
  const byName = new Map(entries.map((entry) => [entry.manifest.name, entry]));
  const ordered = [],
    visited = new Set(),
    visiting = new Set();
  function visit(entry) {
    const {
      name,
      dependencies = {},
      optionalDependencies = {},
    } = entry.manifest;
    if (visited.has(name)) return;
    if (visiting.has(name))
      throw new Error(`Circular release dependency: ${name}`);
    visiting.add(name);
    for (const dependency of Object.keys({
      ...dependencies,
      ...optionalDependencies,
    }).sort()) {
      if (byName.has(dependency)) visit(byName.get(dependency));
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(entry);
  }
  for (const entry of entries) visit(entry);
  return ordered;
}

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
      PNPM_CONFIG_IGNORE_SCRIPTS: "true",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`
    );
  return result.stdout;
}

// A version commit is the durable boundary for retrying an incomplete release.
// Refuse to fold later, unversioned package changes into that version.
export function assertVersionedSource(plan, execute = run) {
  const root = join(process.cwd(), "packages");
  for (const dir of readdirSync(root)) {
    const manifest = JSON.parse(
      readFileSync(join(root, dir, "package.json"), "utf8")
    );
    if (
      !plan.releases.some(
        (r) => r.target && !r.published && r.name === manifest.name
      )
    )
      continue;
    const escaped = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = `^[[:space:]]*"version":[[:space:]]*"${escaped}"`;
    const sha = execute("git", [
      "log",
      "-1",
      "--format=%H",
      "-G",
      pattern,
      "--",
      `packages/${dir}/package.json`,
    ]).trim();
    if (!sha)
      throw new Error(
        `No version commit found for ${manifest.name}@${manifest.version}`
      );
    try {
      execute("git", ["diff", "--exit-code", sha, "HEAD", "--", "packages"]);
    } catch {
      throw new Error(
        `Package source changed after ${manifest.name}@${manifest.version} was versioned at ${sha}. Recover the original release artifacts or commit fresh package versions before publishing.`
      );
    }
  }
}

export function packPackages(plan, directory, execute = run) {
  mkdirSync(directory, { recursive: true });
  const root = join(process.cwd(), "packages");
  const sourceSha = execute("git", ["rev-parse", "HEAD"]).trim();
  for (const dir of readdirSync(root)) {
    const cwd = join(root, dir);
    const manifest = JSON.parse(
      readFileSync(join(cwd, "package.json"), "utf8")
    );
    if (manifest.private) continue;
    // pnpm resolves workspace: references; npm publishes the resulting immutable
    // tarball. All packages are packed before any package is sent to npm.
    const manifestPath = join(cwd, "package.json");
    const original = readFileSync(manifestPath, "utf8");
    try {
      // Preserve source attribution even when publishing a tarball instead of
      // a directory (npm does not infer gitHead for tarball inputs).
      writeFileSync(
        manifestPath,
        JSON.stringify({ ...manifest, gitHead: sourceSha }, null, 2)
      );
      execute(
        "pnpm",
        [
          "--config.node-linker=hoisted",
          "pack",
          "--config.ignore-scripts=true",
          "--pack-destination",
          directory,
        ],
        cwd
      );
    } finally {
      writeFileSync(manifestPath, original);
    }
    const artifact = join(
      directory,
      `${manifest.name.replace(/^@/u, "").replaceAll("/", "-")}-${manifest.version}.tgz`
    );
    const files = packedFilesFromNpmPackJson(
      execute("npm", [
        "pack",
        "--dry-run",
        "--ignore-scripts",
        "--json",
        artifact,
      ])
    );
    const errors = packedArtifactErrors(manifest, files);
    if (errors.length)
      throw new Error(`${manifest.name}: ${errors.join(", ")}`);
    const release = plan.releases.find((item) => item.name === manifest.name);
    if (!release || release.version !== manifest.version)
      throw new Error(`Release plan does not match ${manifest.name}`);
    if (!release.published) release.sourceSha = sourceSha;
    release.artifact = artifact;
    release.integrity = createHash("sha512")
      .update(readFileSync(artifact))
      .digest("base64");
  }
}

export function publishPackages(plan, execute = run) {
  const entries = plan.releases
    .filter((release) => release.target && !release.published)
    .map((release) => {
      if (!release.artifact || !release.integrity)
        throw new Error(`No verified tarball for ${release.name}`);
      const integrity = createHash("sha512")
        .update(readFileSync(release.artifact))
        .digest("base64");
      if (integrity !== release.integrity)
        throw new Error(`Tarball changed after verification: ${release.name}`);
      // Read the packed manifest, including the resolved workspace dependencies.
      const manifest = JSON.parse(
        execute("tar", ["-xOf", release.artifact, "package/package.json"])
      );
      if (
        manifest.name !== release.name ||
        manifest.version !== release.version
      )
        throw new Error(`Wrong tarball for ${release.name}`);
      return { release, manifest };
    });
  for (const { release } of publicationOrder(entries)) {
    console.log(`Publishing ${release.name}@${release.version}`);
    execute("npm", [
      "publish",
      release.artifact,
      "--tag",
      release.channelTag,
      "--access",
      "public",
      "--ignore-scripts",
    ]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [command, planFile, outputDirectory] = process.argv.slice(2);
    const plan = JSON.parse(readFileSync(planFile, "utf8"));
    if (command === "assert-source") {
      assertVersionedSource(plan);
    } else if (command === "pack") {
      packPackages(plan, resolve(outputDirectory));
      writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
    } else if (command === "publish") {
      publishPackages(plan);
    } else throw new Error(`Unknown release-packages command: ${command}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
