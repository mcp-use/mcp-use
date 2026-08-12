import type { SkillsOptions, SkillsSnapshot } from "./types.js";

/**
 * Filesystem discovery is unavailable in non-Node runtimes. Build-time
 * tooling primes an embedded snapshot before the server starts.
 *
 * @internal
 */
export function discoverConfiguredSkills(
  config: boolean | SkillsOptions | undefined,
  _projectRoot: string,
  _conventionalDirectory = "skills"
): SkillsSnapshot | undefined {
  if (config === true || (typeof config === "object" && config !== null)) {
    throw new Error(
      "Skills filesystem discovery is unavailable in this runtime. Run `mcp-use build` to embed the configured skills directory."
    );
  }
  return undefined;
}
