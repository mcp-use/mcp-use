/** Configuration consumed by the CLI's internal Skills discovery boundary. */
export interface SkillsOptions {
  directory?: string;
}

/** One immutable text or binary resource produced by CLI discovery. */
export type SkillResourceSnapshot = {
  uri: string;
  name: string;
  mimeType: string;
  digest: string;
} & ({ text: string; blob?: never } | { blob: string; text?: never });

/** Complete static Skills catalog passed from CLI tooling to the server. */
export interface SkillsSnapshot {
  skills: Array<{
    uri: string;
    frontmatter: Record<string, unknown>;
    resources: Array<{ uri: string; digest: string }>;
  }>;
  resources: SkillResourceSnapshot[];
  directories: Array<{ uri: string; name: string }>;
}
