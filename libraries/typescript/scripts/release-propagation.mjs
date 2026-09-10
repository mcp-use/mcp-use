import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import assembleModule from "@changesets/assemble-release-plan";
import * as configModule from "@changesets/config";
import readModule from "@changesets/read";
import semver from "semver";

const assemble = assembleModule.default ?? assembleModule;
const readChangesets = readModule.default ?? readModule;
const generatedPrefix = "propagated-";

// Build inputs, not npm dependencies. These packages ship embedded workspace code.
export const bundledInputs = {
  "@mcp-use/inspector": ["@mcp-use/agent", "@mcp-use/client"],
  "@mcp-use/cli": ["@mcp-use/tunnel"],
};

export function packageEntries(root) {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, "packages", entry.name, "package.json"))
    .filter(existsSync)
    .map((file) => ({
      dir: dirname(file),
      packageJson: JSON.parse(readFileSync(file, "utf8")),
    }))
    .filter(({ packageJson }) => !packageJson.private);
}

function json(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function internalMetadata(manifest, versions) {
  return Object.fromEntries(
    ["dependencies", "optionalDependencies", "peerDependencies"].map(
      (field) => [
        field,
        Object.fromEntries(
          Object.entries(manifest[field] ?? {})
            .filter(([name]) => versions.has(name))
            .map(([name, range]) => {
              if (range.startsWith("workspace:")) {
                range = range.slice(10);
                if (range === "*") range = versions.get(name);
                else if (range === "^" || range === "~")
                  range += versions.get(name);
              }
              return [name, range];
            })
        ),
      ]
    )
  );
}

export function metadataErrors(manifests) {
  const versions = new Map(
    manifests.map((manifest) => [manifest.name, manifest.version])
  );
  const errors = [];
  for (const manifest of manifests) {
    for (const [field, entries] of Object.entries(
      internalMetadata(manifest, versions)
    )) {
      for (const [name, range] of Object.entries(entries)) {
        if (!semver.satisfies(versions.get(name), range)) {
          errors.push(
            `${manifest.name}@${manifest.version} ${field}.${name} (${range}) rejects ${versions.get(name)}`
          );
        }
      }
    }
  }
  return errors;
}

export async function prepareRelease(root, channel) {
  const preFile = join(root, ".changeset/pre.json");
  const pre = existsSync(preFile)
    ? JSON.parse(readFileSync(preFile, "utf8"))
    : undefined;
  if (channel === "canary" && (pre?.mode !== "pre" || pre.tag !== "canary")) {
    throw new Error("Canary preparation requires canary prerelease mode");
  }
  const entries = packageEntries(root);
  const names = new Set(entries.map(({ packageJson }) => packageJson.name));
  const packages = {
    root: {
      dir: root,
      packageJson: { name: "release-workspace", private: true },
    },
    packages: entries,
  };
  const config = await configModule.read(root, packages);
  const changesets = await readChangesets(root);
  const applied = new Set(pre?.mode === "pre" ? pre.changesets : []);
  const pending = changesets.filter(({ id }) => !applied.has(id));
  const seeds = pending.filter(({ id }) => !id.startsWith(generatedPrefix));
  if (!seeds.length && pre?.mode !== "exit") return;
  const id =
    generatedPrefix +
    createHash("sha256")
      .update(
        seeds
          .map(({ id }) => id)
          .sort()
          .join("\n")
      )
      .digest("hex")
      .slice(0, 16);
  const generated = changesets.find((change) => change.id === id) ?? {
    id,
    releases: [],
    summary:
      "Rebuild bundled workspace code and synchronize published internal package metadata.",
  };
  if (!changesets.includes(generated)) changesets.push(generated);
  const explicit = new Set(
    seeds.flatMap(({ releases }) => releases.map(({ name }) => name))
  );
  const add = (name) => {
    if (
      explicit.has(name) ||
      generated.releases.some((release) => release.name === name)
    )
      return false;
    generated.releases.push({ name, type: "patch" });
    return true;
  };
  const before = new Map(
    entries.map(({ dir, packageJson }) => [dir, JSON.stringify(packageJson)])
  );

  // Peers are compatibility declarations, not build edges. Calculate versions
  // with Changesets first, then reconcile peers and include every changed owner.
  // Removing internal peers only from this in-memory provisional graph avoids
  // Changesets interpreting stale canary metadata as an unintended major bump.
  for (let iteration = 0; iteration < entries.length * 4 + 4; iteration++) {
    const provisional = {
      ...packages,
      packages: entries.map((entry) => ({
        ...entry,
        packageJson: {
          ...entry.packageJson,
          peerDependencies: Object.fromEntries(
            Object.entries(entry.packageJson.peerDependencies ?? {}).filter(
              ([name]) => !names.has(name)
            )
          ),
        },
      })),
    };
    const plan = assemble(changesets, provisional, config, pre);
    const releases = new Map(
      plan.releases
        .filter(({ type }) => type !== "none")
        .map((release) => [release.name, release])
    );
    const versions = new Map(
      entries.map(({ packageJson: pkg }) => [
        pkg.name,
        releases.get(pkg.name)?.newVersion ?? pkg.version,
      ])
    );
    let changed = false;
    for (const [owner, inputs] of Object.entries(bundledInputs)) {
      if (names.has(owner) && inputs.some((input) => releases.has(input)))
        changed = add(owner) || changed;
    }
    for (const { packageJson: pkg } of entries) {
      for (const [name, currentRange] of Object.entries(
        pkg.peerDependencies ?? {}
      )) {
        if (!names.has(name)) continue;
        const version = versions.get(name);
        const range = internalMetadata(pkg, versions).peerDependencies[name];
        if (
          semver.satisfies(version, range) &&
          !currentRange.startsWith("workspace:")
        )
          continue;
        const base = pre?.initialVersions?.[name] ?? version;
        const stable = (value) =>
          `${semver.major(value)}.${semver.minor(value)}.${semver.patch(value)}`;
        const old = currentRange.startsWith("workspace:")
          ? `^${stable(base)}`
          : currentRange;
        if (
          semver.major(version) !== semver.major(base) &&
          !semver.satisfies(version, range)
        ) {
          throw new Error(
            `${pkg.name}: explicitly declare compatibility with ${name}@${version} before releasing a new major`
          );
        }
        const supported = semver.prerelease(version)
          ? `^${stable(version)}-${pre.tag}.0`
          : `^${version}`;
        const current = entries.find(
          ({ packageJson }) => packageJson.name === name
        ).packageJson.version;
        const currentCanary =
          semver.prerelease(current) && pre?.mode === "pre"
            ? `^${stable(current)}-${pre.tag}.0`
            : undefined;
        pkg.peerDependencies[name] = [
          ...new Set(
            [...old.split(" || "), currentCanary, supported].filter(Boolean)
          ),
        ].join(" || ");
        changed = add(pkg.name) || changed;
      }
    }
    if (changed) continue;
    const finalPlan = assemble(changesets, packages, config, pre);
    for (const release of finalPlan.releases.filter(
      ({ type }) => type !== "none"
    )) {
      if (release.newVersion !== versions.get(release.name))
        throw new Error(`Unresolved release propagation for ${release.name}`);
    }
    const errors = metadataErrors(
      entries.map(({ packageJson }) => ({
        ...packageJson,
        version: versions.get(packageJson.name),
      }))
    );
    // Changesets updates normal internal dependency ranges during versioning.
    const peerErrors = errors.filter((error) =>
      error.includes(" peerDependencies.")
    );
    if (peerErrors.length) throw new Error(peerErrors.join("\n"));
    for (const { dir, packageJson } of entries) {
      if (JSON.stringify(packageJson) !== before.get(dir))
        json(join(dir, "package.json"), packageJson);
    }
    if (generated.releases.length) {
      generated.releases.sort((a, b) => a.name.localeCompare(b.name));
      writeFileSync(
        join(root, ".changeset", `${id}.md`),
        `---\n${generated.releases.map(({ name, type }) => `"${name}": ${type}`).join("\n")}\n---\n\n${generated.summary}\n`
      );
    }
    console.log(
      `Prepared release propagation: ${[...releases.keys()].join(", ")}`
    );
    return finalPlan;
  }
  throw new Error("Release propagation did not converge");
}
