export const SKILLS_REPO = "https://github.com/mcp-use/mcp-use.git";
export const SKILLS_BRANCH = "beta";
export const SKILLS_SPARSE_PATH = "skills/mcp-apps-builder";
export const SKILLS_AGENT_DIRS = [".cursor", ".claude", ".agents"] as const;
export const SKILLS_MANUAL_INSTALL_CMD =
  "npx --yes skills add mcp-use/mcp-use#beta --yes --skill mcp-apps-builder -a cursor -a claude-code -a codex";

export function getSkillsCloneArgs(repoDir: string): string[] {
  return [
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--sparse",
    "--single-branch",
    "--branch",
    SKILLS_BRANCH,
    SKILLS_REPO,
    repoDir,
  ];
}
