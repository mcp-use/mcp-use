import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function changesetCheckArgs({ base, mode, pending }) {
  if (!/^[a-f0-9]{40}$/.test(base)) {
    throw new Error(
      "The changeset check requires the PR's exact base commit SHA"
    );
  }
  if (!["ordinary", "promotion", "version"].includes(mode)) {
    throw new Error(`Unknown PR release mode: ${mode}`);
  }
  // A bot version PR consumes changesets. Canary promotion can carry already
  // applied prerelease changesets; neither should require an extra version bump.
  if (mode === "version" || (mode === "promotion" && pending.length === 0)) {
    return null;
  }
  return ["exec", "changeset", "status", "--since", base];
}

export function pendingChangesets(root) {
  let applied = [];
  try {
    applied =
      JSON.parse(readFileSync(join(root, ".changeset/pre.json"), "utf8"))
        .changesets ?? [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return readdirSync(join(root, ".changeset"))
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .map((file) => file.slice(0, -3))
    .filter((id) => !applied.includes(id));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = changesetCheckArgs({
      base: process.env.PR_BASE_SHA,
      mode: process.env.PR_RELEASE_MODE || "ordinary",
      pending: pendingChangesets(process.cwd()),
    });
    if (args === null) {
      console.log("Versioned release PR: no additional changeset is required.");
    } else {
      const result = spawnSync("pnpm", args, { stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(
          "Changeset validation failed. Add pnpm changeset for a release, or pnpm changeset --empty for an intentional no-release change."
        );
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
