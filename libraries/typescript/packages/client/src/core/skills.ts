/** Experimental Skills over MCP extension identifier. */
export const SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills" as const;

/** One immutable resource advertised by a remote skill. */
export interface SkillResource {
  /** Absolute MCP resource URI. */
  uri: string;
  /** SHA-256 digest of the raw resource bytes. */
  digest: string;
}

/** One skill catalog entry returned by `skills/list` or `skills/get`. */
export interface Skill {
  /** URI of the skill's root `SKILL.md`. */
  uri: string;
  /** Verbatim parsed YAML frontmatter. */
  frontmatter: Record<string, unknown>;
  /** Complete resource manifest when the server exposes a static skill. */
  resources?: SkillResource[];
}

/** Paginated result returned by `skills/list`. */
export interface SkillsListResult {
  skills: Skill[];
  nextCursor?: string;
}

/** Result returned by `skills/get`. */
export interface SkillGetResult {
  skill: Skill;
}

/** One child returned by `resources/directory/read`. */
export interface SkillDirectoryEntry {
  uri: string;
  name?: string;
  mimeType?: string;
}

/** Paginated result returned by `resources/directory/read`. */
export interface SkillDirectoryReadResult {
  resources: SkillDirectoryEntry[];
  nextCursor?: string;
}
