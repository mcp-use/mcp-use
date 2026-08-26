/** Identifier negotiated for the experimental Skills over MCP extension. */
export const SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills" as const;

/** Configuration for file-based Agent Skills discovery. */
export interface SkillsOptions {
  /**
   * Skill source directory, relative to the project root.
   *
   * @defaultValue `"skills"`
   */
  directory?: string;
}

/** One immutable file exposed by a skill snapshot. */
export type SkillResourceSnapshot = {
  /** Absolute MCP resource URI. */
  uri: string;
  /** File basename advertised as resource metadata. */
  name: string;
  /** MIME type advertised and returned for the resource. */
  mimeType: string;
  /** SHA-256 digest of the raw file bytes. */
  digest: string;
} & (
  | {
      /** UTF-8 contents for text resources. */
      text: string;
      /** Binary content is absent for text resources. */
      blob?: never;
    }
  | {
      /** Base64 contents for binary resources. */
      blob: string;
      /** Text content is absent for binary resources. */
      text?: never;
    }
);

/** A SEP-2640 skill entry and its complete resource manifest. */
export interface SkillSnapshotEntry {
  /** URI of the skill's root `SKILL.md`. */
  uri: string;
  /** Verbatim YAML frontmatter rendered as JSON. */
  frontmatter: Record<string, unknown>;
  /** Complete, deterministic file set for this skill. */
  resources: Array<{
    /** Resource URI of one file belonging to the skill. */
    uri: string;
    /** SHA-256 digest of that file's raw bytes. */
    digest: string;
  }>;
}

/** One directory resource retained for scoped directory reads. */
export interface SkillDirectorySnapshot {
  /** Absolute directory resource URI without a trailing slash. */
  uri: string;
  /** Final decoded path segment advertised to hosts. */
  name: string;
}

/** Static Skills over MCP snapshot embedded or discovered before serving. */
export interface SkillsSnapshot {
  /** Skill entries in URI order. */
  skills: SkillSnapshotEntry[];
  /** Unique resource contents in URI order. */
  resources: SkillResourceSnapshot[];
  /** Directory resources, including empty directories, in URI order. */
  directories: SkillDirectorySnapshot[];
}

/** Symbol used by tooling to prime an {@link MCPServer} with a snapshot. */
export const registerSkills = Symbol.for("mcp-use.registerSkills");
