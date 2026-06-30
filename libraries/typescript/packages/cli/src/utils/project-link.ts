import { promises as fs } from "node:fs";
import { resolveWorkspace } from "mcp-use/config";
import { ensureGitignore } from "./gitignore.js";

interface ProjectLink {
  deploymentId: string;
  deploymentName: string;
  deploymentUrl?: string;
  linkedAt: string;
  serverId?: string;
}

// Read project link from the per-project workspace (`.mcp-use/cloud/link.json`).
export async function getProjectLink(cwd: string): Promise<ProjectLink | null> {
  try {
    const { paths } = await resolveWorkspace({ cwd });
    const content = await fs.readFile(paths.cloudLink, "utf-8");
    return JSON.parse(content);
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// Write project link to the per-project workspace (`.mcp-use/cloud/link.json`).
export async function saveProjectLink(
  cwd: string,
  link: ProjectLink
): Promise<void> {
  const { paths } = await resolveWorkspace({ cwd });
  await fs.mkdir(paths.cloud, { recursive: true });
  await fs.writeFile(paths.cloudLink, JSON.stringify(link, null, 2), "utf-8");

  // Keep `.mcp-use` (and secrets) ignored. Routed through the single shared
  // writer so there is exactly one `.gitignore` implementation.
  await ensureGitignore(cwd);
}
