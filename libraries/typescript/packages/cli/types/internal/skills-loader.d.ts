/** Configuration accepted by the CLI's internal Node-only Skills loader. */
export interface SkillsOptions {
  directory?: string;
}

export type SkillResourceSnapshot = {
  uri: string;
  name: string;
  mimeType: string;
  digest: string;
} & ({ text: string; blob?: never } | { blob: string; text?: never });

export interface SkillsSnapshot {
  skills: Array<{
    uri: string;
    frontmatter: Record<string, unknown>;
    resources: Array<{ uri: string; digest: string }>;
  }>;
  resources: SkillResourceSnapshot[];
  directories: Array<{ uri: string; name: string }>;
}

/** Optional controls for Node-only skill discovery. */
export interface SkillsDiscoveryOptions {
  /** Recover from independently invalid skills; omit for strict discovery. */
  onInvalidSkill?: (error: Error) => void;
  /** Override resource reads, primarily for deterministic failure testing. */
  readResourceFile?: (path: string) => Buffer;
}

/** Discover and validate an immutable Skills snapshot from a project tree. */
export declare function discoverConfiguredSkills(
  config: boolean | SkillsOptions | undefined,
  projectRoot: string,
  conventionalDirectory?: string,
  options?: SkillsDiscoveryOptions
): SkillsSnapshot | undefined;

/** Resolve the effective directory watched and read by CLI tooling. */
export declare function resolveConfiguredSkillsDirectory(
  config: boolean | SkillsOptions | undefined,
  projectRoot: string,
  conventionalDirectory?: string
): string | undefined;
