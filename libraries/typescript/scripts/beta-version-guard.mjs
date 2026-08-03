import { readFileSync } from "node:fs";

import semver from "semver";

function fail(message) {
  throw new Error(`[beta-release] ${message}`);
}

/**
 * Rejects a prerelease plan that cannot produce a new npm beta version.
 *
 * This check runs before Changesets mutates manifests or marks changesets as
 * applied. A published source manifest is a valid starting point, but every
 * planned version must still be a new version beyond the registry's beta tag.
 */
export function validateBetaVersionPlan({ manifests, metadata, releases }) {
  for (const release of releases) {
    const manifest = manifests.get(release.name);
    if (!manifest) fail(`Changesets planned unknown package ${release.name}`);

    const current = semver.parse(manifest.version);
    const planned = semver.parse(release.newVersion);
    if (
      !planned ||
      planned.prerelease[0] !== "beta" ||
      !Number.isInteger(planned.prerelease[1])
    ) {
      fail(
        `${release.name} planned ${release.newVersion}, which is not an x.y.z-beta.N version`
      );
    }

    if (
      current?.prerelease[0] === "beta" &&
      !semver.gt(release.newVersion, manifest.version)
    ) {
      fail(
        `${release.name} planned ${release.newVersion} from ${manifest.version}; a pending changeset must advance the source beta version`
      );
    }

    const registry = metadata.get(release.name);
    if (registry?.versions?.[release.newVersion]) {
      fail(
        `${release.name}@${release.newVersion} is already published; refusing to consume pending changesets without a new version`
      );
    }

    const betaTag = registry?.["dist-tags"]?.beta;
    if (betaTag && !semver.gt(release.newVersion, betaTag)) {
      fail(
        `${release.name}@${release.newVersion} would not advance the current beta tag ${betaTag}`
      );
    }
  }
}

export async function fetchRegistryMetadata(names) {
  if (process.env.BETA_RELEASE_REGISTRY_METADATA_PATH) {
    const fixture = JSON.parse(
      readFileSync(process.env.BETA_RELEASE_REGISTRY_METADATA_PATH, "utf8")
    );
    return new Map(names.map((name) => [name, fixture[name]]));
  }

  const metadata = new Map();
  for (const name of names) {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      { headers: { accept: "application/vnd.npm.install-v1+json" } }
    );
    if (response.status === 404) {
      metadata.set(name, undefined);
      continue;
    }
    if (!response.ok)
      fail(`npm registry returned ${response.status} for ${name}`);
    metadata.set(name, await response.json());
  }
  return metadata;
}
