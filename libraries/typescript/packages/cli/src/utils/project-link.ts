import { promises as fs } from "node:fs";
import path from "node:path";

const MCP_USE_DIR = ".mcp-use";
const MCP_USE_CLOUD_DIR = "cloud";
const MCP_USE_CLOUD_LINK = "link.json";
const LEGACY_PROJECT_LINK = "project.json";

interface ProjectLink {
  deploymentId: string;
  deploymentName: string;
  deploymentUrl?: string;
  linkedAt: string;
  serverId?: string;
}

// Get .mcp-use directory path
function getMcpUseDirectory(cwd: string): string {
  return path.join(cwd, MCP_USE_DIR);
}

function getCloudLinkPath(cwd: string): string {
  return path.join(
    getMcpUseDirectory(cwd),
    MCP_USE_CLOUD_DIR,
    MCP_USE_CLOUD_LINK
  );
}

// Read project link
export async function getProjectLink(cwd: string): Promise<ProjectLink | null> {
  try {
    const linkPath = getCloudLinkPath(cwd);
    const content = await fs.readFile(linkPath, "utf-8");
    return JSON.parse(content);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }

  try {
    const legacyPath = path.join(getMcpUseDirectory(cwd), LEGACY_PROJECT_LINK);
    const content = await fs.readFile(legacyPath, "utf-8");
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
  const cloudDir = path.join(getMcpUseDirectory(cwd), MCP_USE_CLOUD_DIR);
  await fs.mkdir(cloudDir, { recursive: true });

  const linkPath = getCloudLinkPath(cwd);
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
