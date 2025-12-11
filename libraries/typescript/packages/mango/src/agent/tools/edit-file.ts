import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getProjectPath, isWithinWorkspace } from "../../server/workspace.js";
import type { ToolContext, ToolResult } from "../types.js";
import { createToolDefinition, type AnthropicTool } from "../tool-types.js";

export interface ReadFileParams {
  projectName: string;
  filePath: string;
}

export interface WriteFileParams {
  projectName: string;
  filePath: string;
  content: string;
}

export interface ListFilesParams {
  projectName: string;
  dirPath?: string;
}

/**
 * Read a file from a project
 */
export async function readFileTool(
  params: ReadFileParams,
  context: ToolContext
): Promise<ToolResult> {
  const { projectName, filePath } = params;
  const projectPath = getProjectPath(projectName, context.workspaceDir);
  const fullPath = path.join(projectPath, filePath);

  // Security check
  if (!isWithinWorkspace(fullPath, context.workspaceDir)) {
    return {
      success: false,
      error: "File path is outside workspace directory",
    };
  }

  try {
    if (!existsSync(fullPath)) {
      return {
        success: false,
        error: `File not found: ${filePath}`,
      };
    }

    const content = readFileSync(fullPath, "utf-8");

    return {
      success: true,
      data: {
        filePath,
        content,
        size: content.length,
      },
      message: `Read file: ${filePath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to read file: ${error.message}`,
    };
  }
}

/**
 * Write/update a file in a project
 */
export async function writeFileTool(
  params: WriteFileParams,
  context: ToolContext
): Promise<ToolResult> {
  const { projectName, filePath, content } = params;
  const projectPath = getProjectPath(projectName, context.workspaceDir);
  const fullPath = path.join(projectPath, filePath);

  // Security check
  if (!isWithinWorkspace(fullPath, context.workspaceDir)) {
    return {
      success: false,
      error: "File path is outside workspace directory",
    };
  }

  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, content, "utf-8");

    return {
      success: true,
      data: {
        filePath,
        size: content.length,
      },
      message: `Wrote file: ${filePath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to write file: ${error.message}`,
    };
  }
}

/**
 * List files in a project directory
 */
export async function listFilesTool(
  params: ListFilesParams,
  context: ToolContext
): Promise<ToolResult> {
  const { projectName, dirPath = "." } = params;
  const projectPath = getProjectPath(projectName, context.workspaceDir);
  const fullPath = path.join(projectPath, dirPath);

  // Security check
  if (!isWithinWorkspace(fullPath, context.workspaceDir)) {
    return {
      success: false,
      error: "Directory path is outside workspace directory",
    };
  }

  try {
    if (!existsSync(fullPath)) {
      return {
        success: false,
        error: `Directory not found: ${dirPath}`,
      };
    }

    const entries = readdirSync(fullPath);
    const files: Array<{
      name: string;
      type: "file" | "directory";
      size?: number;
    }> = [];

    for (const entry of entries) {
      const entryPath = path.join(fullPath, entry);
      const stat = statSync(entryPath);

      files.push({
        name: entry,
        type: stat.isDirectory() ? "directory" : "file",
        size: stat.isFile() ? stat.size : undefined,
      });
    }

    return {
      success: true,
      data: {
        directory: dirPath,
        files,
      },
      message: `Listed ${files.length} entries in ${dirPath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to list files: ${error.message}`,
    };
  }
}

/**
 * Tool definitions for Claude Agent SDK
 */
export const readFileToolDefinition: AnthropicTool = createToolDefinition({
  name: "read_file",
  description:
    "Read the contents of a file from an MCP server project in the workspace.",
  properties: {
    projectName: {
      type: "string",
      description: "Name of the MCP server project",
    },
    filePath: {
      type: "string",
      description:
        "Relative path to the file within the project (e.g., 'src/index.ts')",
    },
  },
  required: ["projectName", "filePath"],
});

export const writeFileToolDefinition: AnthropicTool = createToolDefinition({
  name: "write_file",
  description:
    "Write or update a file in an MCP server project. Creates directories if needed.",
  properties: {
    projectName: {
      type: "string",
      description: "Name of the MCP server project",
    },
    filePath: {
      type: "string",
      description:
        "Relative path to the file within the project (e.g., 'src/index.ts')",
    },
    content: {
      type: "string",
      description: "Content to write to the file",
    },
  },
  required: ["projectName", "filePath", "content"],
});

export const listFilesToolDefinition: AnthropicTool = createToolDefinition({
  name: "list_files",
  description: "List files and directories in an MCP server project.",
  properties: {
    projectName: {
      type: "string",
      description: "Name of the MCP server project",
    },
    dirPath: {
      type: "string",
      description: "Relative path to the directory to list (default: '.')",
      default: ".",
    },
  },
  required: ["projectName"],
});
