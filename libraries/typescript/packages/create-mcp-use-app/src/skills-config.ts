export const SKILLS_REPO = "https://github.com/mcp-use/mcp-use.git";
export const SKILLS_SPARSE_PATH = "skills/mcp-apps-builder";
export const SKILLS_AGENT_DIRS = [".cursor", ".claude", ".agents"] as const;

export function getDefaultDistTag(packageVersion: string): "beta" | "latest" {
  return packageVersion.includes("-beta.") ? "beta" : "latest";
}

export function getSkillsBranch(packageVersion: string): "beta" | "main" {
  return getDefaultDistTag(packageVersion) === "beta" ? "beta" : "main";
}

export function getSkillsManualInstallCommand(packageVersion: string): string {
  const branch = getSkillsBranch(packageVersion);
  return `npx --yes skills add mcp-use/mcp-use#${branch} --yes --skill mcp-apps-builder -a cursor -a claude-code -a codex`;
}

export function getSkillsCloneArgs(
  repoDir: string,
  packageVersion: string
): string[] {
  return [
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--sparse",
    "--single-branch",
    "--branch",
    getSkillsBranch(packageVersion),
    SKILLS_REPO,
    repoDir,
  ];
}
