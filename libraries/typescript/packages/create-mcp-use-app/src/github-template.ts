/** Build a shallow template clone, respecting an explicit branch when given. */
export function getTemplateCloneArgs(
  repoUrl: string,
  targetDir: string,
  branch?: string
): string[] {
  const args = ["clone", "--depth", "1"];
  if (branch) {
    args.push("--branch", branch);
  }
  return [...args, repoUrl, targetDir];
}
