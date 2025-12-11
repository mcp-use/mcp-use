import { execa } from "execa";
import { getProjectPath, isWithinWorkspace } from "../../server/workspace.js";
import type { ToolContext, ToolResult } from "../types.js";

export interface CreateServerParams {
  name: string;
  template?: "starter" | "mcp-ui" | "apps-sdk";
}

/**
 * Create a new MCP server using create-mcp-use-app
 */
export async function createServerTool(
  params: CreateServerParams,
  context: ToolContext,
  onProgress?: (message: string) => void
): Promise<ToolResult> {
  const { name, template = "starter" } = params;

  // Validate project name
  if (!name || !/^[a-zA-Z0-9-_]+$/.test(name)) {
    return {
      success: false,
      error:
        "Invalid project name. Use only letters, numbers, hyphens, and underscores.",
    };
  }

  const projectPath = getProjectPath(name, context.workspaceDir);

  // Security check
  if (!isWithinWorkspace(projectPath, context.workspaceDir)) {
    return {
      success: false,
      error: "Project path is outside workspace directory",
    };
  }

  try {
    onProgress?.(
      `🚀 Creating MCP server '${name}' with ${template} template...`
    );

    // Run create-mcp-use-app with streaming output
    const subprocess = execa(
      "npx",
      ["create-mcp-use-app", name, "--template", template, "--install"],
      {
        cwd: context.workspaceDir,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let output = "";

    // Stream stdout
    subprocess.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;
      // Send progress updates for important lines
      const lines = text.split("\n");
      for (const line of lines) {
        if (
          line.includes("Installing") ||
          line.includes("Progress") ||
          line.includes("Packages:") ||
          line.includes("Done in") ||
          line.includes("✅") ||
          line.includes("📦")
        ) {
          onProgress?.(line.trim());
        }
      }
    });

    // Stream stderr
    subprocess.stderr?.on("data", (data) => {
      const text = data.toString();
      output += text;
      onProgress?.(text.trim());
    });

    const { stdout, stderr } = await subprocess;

    onProgress?.(`✅ Server '${name}' created successfully!`);

    return {
      success: true,
      data: {
        projectName: name,
        projectPath,
        template,
        output: stdout || stderr || output,
      },
      message: `Successfully created MCP server '${name}' using ${template} template at ${projectPath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to create server: ${error.message}`,
      data: {
        stdout: error.stdout,
        stderr: error.stderr,
      },
    };
  }
}

import { createToolDefinition, type AnthropicTool } from "../tool-types.js";

/**
 * Tool definition for Claude Agent SDK
 */
export const createServerToolDefinition: AnthropicTool = createToolDefinition({
  name: "create_server",
  description:
    "Create a new MCP server using create-mcp-use-app CLI. This scaffolds a new server project in the workspace.",
  properties: {
    name: {
      type: "string",
      description:
        "Name of the MCP server project (alphanumeric, hyphens, underscores only)",
    },
    template: {
      type: "string",
      enum: ["starter", "mcp-ui", "apps-sdk"],
      description:
        "Template to use: 'starter' (basic server), 'mcp-ui' (with MCP UI widgets), or 'apps-sdk' (with OpenAI Apps SDK widgets)",
      default: "starter",
    },
  },
  required: ["name"],
});
