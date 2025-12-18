import { promises as fs } from "node:fs";
import path from "node:path";

export const MCP_USE_DIR = ".mcp-use";
export const MCP_USE_DIR_PROJECT = "project.json";

export interface ProjectLink {
  deploymentId: string;
  deploymentName: string;
  deploymentUrl?: string;
  linkedAt: string;
}

// Get .mcp-use directory path
export function getMcpUseDirectory(cwd: string): string {
  return path.join(cwd, MCP_USE_DIR);
}

// Read project link
export async function getProjectLink(cwd: string): Promise<ProjectLink | null> {
  try {
    const linkPath = path.join(getMcpUseDirectory(cwd), MCP_USE_DIR_PROJECT);
    const content = await fs.readFile(linkPath, "utf-8");
    return JSON.parse(content);
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// Write project link
export async function saveProjectLink(
  cwd: string,
  link: ProjectLink
): Promise<void> {
  const mcpUseDir = getMcpUseDirectory(cwd);
  await fs.mkdir(mcpUseDir, { recursive: true });

  const linkPath = path.join(mcpUseDir, MCP_USE_DIR_PROJECT);
  await fs.writeFile(linkPath, JSON.stringify(link, null, 2), "utf-8");

  // Add to .gitignore
  await addToGitIgnore(cwd);
}

// Add .mcp-use to .gitignore
async function addToGitIgnore(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, ".gitignore");
  try {
    let content = "";
    try {
      content = await fs.readFile(gitignorePath, "utf-8");
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }

    if (!content.includes(MCP_USE_DIR)) {
      const newContent =
        content +
        (content.endsWith("\n") ? "" : "\n") +
        `\n# mcp-use deployment\n${MCP_USE_DIR}\n`;
      await fs.writeFile(gitignorePath, newContent, "utf-8");
    }
  } catch (err) {
    // Ignore gitignore errors
  }
}
