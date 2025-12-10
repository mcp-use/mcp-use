/**
 * Workspace directory management for Mango
 * Handles creation and organization of MCP server projects
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, normalize } from "node:path";
import type { ProjectInfo, WorkspaceConfig } from "../types.js";

export class WorkspaceManager {
  private workspaceDir: string;
  private maxProjects: number;

  constructor(config: WorkspaceConfig = {}) {
    this.workspaceDir = config.workspaceDir || join(homedir(), "mcp-servers");
    this.maxProjects = config.maxProjects || 100;
    this.ensureWorkspaceExists();
  }

  /**
   * Ensure the workspace directory exists
   */
  private ensureWorkspaceExists(): void {
    if (!existsSync(this.workspaceDir)) {
      mkdirSync(this.workspaceDir, { recursive: true });
    }
  }

  /**
   * Get the workspace directory path
   */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /**
   * Validate project name for security
   * Prevents path traversal and ensures valid directory names
   */
  private validateProjectName(name: string): void {
    if (!name || typeof name !== "string") {
      throw new Error("Project name must be a non-empty string");
    }

    // Check for path traversal attempts
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      throw new Error('Project name cannot contain path separators or ".."');
    }

    // Check for valid characters (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        "Project name can only contain letters, numbers, hyphens, and underscores"
      );
    }

    // Check for reserved names
    const reservedNames = ["node_modules", ".git", ".env", "src", "dist"];
    if (reservedNames.includes(name.toLowerCase())) {
      throw new Error(`Project name "${name}" is reserved`);
    }
  }

  /**
   * Validate that a path is within the workspace directory
   */
  private validatePathInWorkspace(path: string): void {
    const normalizedPath = normalize(resolve(path));
    const normalizedWorkspace = normalize(resolve(this.workspaceDir));

    if (!normalizedPath.startsWith(normalizedWorkspace)) {
      throw new Error("Path is outside workspace directory");
    }
  }

  /**
   * Create a project directory in the workspace
   */
  createProjectDir(name: string): string {
    this.validateProjectName(name);

    const projectPath = join(this.workspaceDir, name);

    // Check if project already exists
    if (existsSync(projectPath)) {
      throw new Error(`Project "${name}" already exists`);
    }

    // Check max projects limit
    const existingProjects = this.listProjects();
    if (existingProjects.length >= this.maxProjects) {
      throw new Error(
        `Maximum number of projects (${this.maxProjects}) reached`
      );
    }

    // Create the project directory
    mkdirSync(projectPath, { recursive: true });

    return projectPath;
  }

  /**
   * Get the full path to a project
   */
  getProjectPath(name: string): string {
    this.validateProjectName(name);
    const projectPath = join(this.workspaceDir, name);

    if (!existsSync(projectPath)) {
      throw new Error(`Project "${name}" does not exist`);
    }

    return projectPath;
  }

  /**
   * List all projects in the workspace
   */
  listProjects(): ProjectInfo[] {
    if (!existsSync(this.workspaceDir)) {
      return [];
    }

    const entries = readdirSync(this.workspaceDir, { withFileTypes: true });
    const projects: ProjectInfo[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const projectPath = join(this.workspaceDir, entry.name);
        const stats = statSync(projectPath);

        // Get list of files in the project (non-recursive, top-level only)
        let files: string[] = [];
        try {
          files = readdirSync(projectPath).filter((f) => !f.startsWith("."));
        } catch (error) {
          // Skip if we can't read the directory
          continue;
        }

        projects.push({
          name: entry.name,
          path: projectPath,
          createdAt: stats.birthtime,
          files,
        });
      }
    }

    // Sort by creation date (newest first)
    return projects.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * Get detailed information about a specific project
   */
  getProjectInfo(name: string): ProjectInfo | null {
    this.validateProjectName(name);
    const projectPath = join(this.workspaceDir, name);

    if (!existsSync(projectPath)) {
      return null;
    }

    const stats = statSync(projectPath);

    // Recursively get all files in the project
    const getAllFiles = (dir: string, baseDir: string = dir): string[] => {
      let files: string[] = [];
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.substring(baseDir.length + 1);

        // Skip node_modules and hidden files/directories
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }

        if (entry.isDirectory()) {
          files = files.concat(getAllFiles(fullPath, baseDir));
        } else {
          files.push(relativePath);
        }
      }

      return files;
    };

    const files = getAllFiles(projectPath);

    return {
      name,
      path: projectPath,
      createdAt: stats.birthtime,
      files,
    };
  }

  /**
   * Check if a project exists
   */
  projectExists(name: string): boolean {
    try {
      this.validateProjectName(name);
      const projectPath = join(this.workspaceDir, name);
      return existsSync(projectPath);
    } catch {
      return false;
    }
  }

  /**
   * Validate a file path is within a project in the workspace
   */
  validateFilePath(projectName: string, relativePath: string): string {
    this.validateProjectName(projectName);

    const projectPath = this.getProjectPath(projectName);
    const fullPath = resolve(join(projectPath, relativePath));

    // Ensure the file path is within the project directory
    this.validatePathInWorkspace(fullPath);

    if (!fullPath.startsWith(normalize(projectPath))) {
      throw new Error("File path is outside project directory");
    }

    return fullPath;
  }
}
