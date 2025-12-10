/**
 * File operation tools for Mango agent
 * Provides read, write, and list operations with security restrictions
 */

import { StructuredTool } from "@langchain/core/tools";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { WorkspaceManager } from "../../server/workspace.js";

/**
 * ReadFileTool - Read contents of a file in a project
 */
export class ReadFileTool extends StructuredTool {
  name = "read_file";
  description = `Read the contents of a file in an MCP server project.
  The file path should be relative to the project root (e.g., "src/index.ts", "package.json").
  This is useful for inspecting existing code, configurations, or documentation.`;

  schema = z.object({
    projectName: z.string().describe("Name of the MCP server project"),
    filePath: z
      .string()
      .describe(
        'Path to the file relative to project root (e.g., "src/index.ts")'
      ),
  });

  private workspaceManager: WorkspaceManager;

  constructor(workspaceManager: WorkspaceManager) {
    super();
    this.workspaceManager = workspaceManager;
  }

  protected async _call({
    projectName,
    filePath,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Validate and get full file path (includes security checks)
      const fullPath = this.workspaceManager.validateFilePath(
        projectName,
        filePath
      );

      // Read the file
      const content = readFileSync(fullPath, "utf-8");

      let result = `📄 File: ${filePath}\n`;
      result += `📏 Size: ${content.length} bytes\n`;
      result += `\n${"─".repeat(60)}\n\n`;
      result += content;

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read file: ${message}`);
    }
  }
}

/**
 * WriteFileTool - Write or update a file in a project
 */
export class WriteFileTool extends StructuredTool {
  name = "write_file";
  description = `Write or update a file in an MCP server project.
  The file path should be relative to the project root.
  If the file doesn't exist, it will be created (including parent directories).
  If it exists, it will be overwritten.
  Use this to create new files, update existing code, or modify configurations.`;

  schema = z.object({
    projectName: z.string().describe("Name of the MCP server project"),
    filePath: z
      .string()
      .describe(
        'Path to the file relative to project root (e.g., "src/tools/my-tool.ts")'
      ),
    content: z.string().describe("Content to write to the file"),
  });

  private workspaceManager: WorkspaceManager;

  constructor(workspaceManager: WorkspaceManager) {
    super();
    this.workspaceManager = workspaceManager;
  }

  protected async _call({
    projectName,
    filePath,
    content,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Validate and get full file path (includes security checks)
      const fullPath = this.workspaceManager.validateFilePath(
        projectName,
        filePath
      );

      // Create parent directories if they don't exist
      const parentDir = dirname(fullPath);
      mkdirSync(parentDir, { recursive: true });

      // Write the file
      writeFileSync(fullPath, content, "utf-8");

      let result = `✅ Successfully wrote file: ${filePath}\n`;
      result += `📏 Size: ${content.length} bytes\n`;
      result += `📁 Location: ${fullPath}`;

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write file: ${message}`);
    }
  }
}

/**
 * ListFilesTool - List files in a project directory
 */
export class ListFilesTool extends StructuredTool {
  name = "list_files";
  description = `List files and directories in an MCP server project.
  Provide a directory path relative to the project root, or leave empty to list the project root.
  This helps you understand the project structure and find files to read or edit.`;

  schema = z.object({
    projectName: z.string().describe("Name of the MCP server project"),
    directoryPath: z
      .string()
      .optional()
      .describe("Path to directory relative to project root (empty for root)"),
    recursive: z
      .boolean()
      .default(false)
      .describe("Whether to list files recursively"),
  });

  private workspaceManager: WorkspaceManager;

  constructor(workspaceManager: WorkspaceManager) {
    super();
    this.workspaceManager = workspaceManager;
  }

  protected async _call({
    projectName,
    directoryPath = "",
    recursive = false,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Validate and get full directory path
      const fullPath = this.workspaceManager.validateFilePath(
        projectName,
        directoryPath
      );

      const listFiles = (dir: string, indent: string = ""): string[] => {
        const entries = readdirSync(dir, { withFileTypes: true });
        const lines: string[] = [];

        // Sort: directories first, then files alphabetically
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const entry of sorted) {
          // Skip node_modules and hidden files
          if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
          }

          const entryPath = join(dir, entry.name);
          const stats = statSync(entryPath);

          if (entry.isDirectory()) {
            lines.push(`${indent}📁 ${entry.name}/`);
            if (recursive) {
              lines.push(...listFiles(entryPath, indent + "  "));
            }
          } else {
            const size = stats.size;
            const sizeStr =
              size < 1024
                ? `${size}B`
                : size < 1024 * 1024
                  ? `${Math.round(size / 1024)}KB`
                  : `${Math.round(size / (1024 * 1024))}MB`;
            lines.push(`${indent}📄 ${entry.name} (${sizeStr})`);
          }
        }

        return lines;
      };

      const files = listFiles(fullPath);

      let result = `📁 ${directoryPath || projectName}/\n\n`;
      result += files.join("\n");
      result += `\n\n${files.length} items listed`;
      if (!recursive) {
        result += " (use recursive=true to see subdirectories)";
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list files: ${message}`);
    }
  }
}
