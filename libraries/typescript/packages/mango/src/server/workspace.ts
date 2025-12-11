import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Get the default workspace directory for MCP servers
 */
export function getDefaultWorkspaceDir(): string {
  return path.join(homedir(), "mcp-servers");
}

/**
 * Get or create the workspace directory
 */
export function getWorkspaceDir(customPath?: string): string {
  const workspaceDir = customPath || getDefaultWorkspaceDir();

  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }

  return workspaceDir;
}

/**
 * Create a project directory within the workspace
 */
export function createProjectDir(
  projectName: string,
  workspaceDir?: string
): string {
  const workspace = getWorkspaceDir(workspaceDir);
  const projectPath = path.join(workspace, projectName);

  if (!existsSync(projectPath)) {
    mkdirSync(projectPath, { recursive: true });
  }

  return projectPath;
}

/**
 * List all projects in the workspace
 */
export function listProjects(
  workspaceDir?: string
): Array<{ name: string; path: string }> {
  const workspace = getWorkspaceDir(workspaceDir);

  if (!existsSync(workspace)) {
    return [];
  }

  const entries = readdirSync(workspace);
  const projects: Array<{ name: string; path: string }> = [];

  for (const entry of entries) {
    const fullPath = path.join(workspace, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      projects.push({
        name: entry,
        path: fullPath,
      });
    }
  }

  return projects;
}

/**
 * Get the full path to a project
 */
export function getProjectPath(
  projectName: string,
  workspaceDir?: string
): string {
  const workspace = getWorkspaceDir(workspaceDir);
  return path.join(workspace, projectName);
}

/**
 * Check if a path is within the workspace (security check)
 */
export function isWithinWorkspace(
  filePath: string,
  workspaceDir?: string
): boolean {
  const workspace = getWorkspaceDir(workspaceDir);
  const resolvedPath = path.resolve(filePath);
  const resolvedWorkspace = path.resolve(workspace);

  return resolvedPath.startsWith(resolvedWorkspace);
}
