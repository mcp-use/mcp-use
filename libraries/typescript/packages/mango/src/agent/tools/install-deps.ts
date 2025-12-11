import { execa } from "execa";
import { getProjectPath, isWithinWorkspace } from "../../server/workspace.js";
import type { ToolContext, ToolResult } from "../types.js";

export interface InstallDepsParams {
  projectName: string;
  packageManager?: "npm" | "yarn" | "pnpm";
}

/**
 * Install dependencies in a project
 */
export async function installDepsTool(
  params: InstallDepsParams,
  context: ToolContext,
  onProgress?: (message: string) => void
): Promise<ToolResult> {
  const { projectName, packageManager = "yarn" } = params;
  const projectPath = getProjectPath(projectName, context.workspaceDir);

  // Security check
  if (!isWithinWorkspace(projectPath, context.workspaceDir)) {
    return {
      success: false,
      error: "Project path is outside workspace directory",
    };
  }

  try {
    onProgress?.(`📦 Installing dependencies with ${packageManager}...`);

    const subprocess = execa(packageManager, ["install"], {
      cwd: projectPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    // Stream stdout
    subprocess.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;
      const lines = text.split("\n");
      for (const line of lines) {
        if (
          line.includes("Progress") ||
          line.includes("Packages") ||
          line.includes("Done") ||
          line.includes("added")
        ) {
          onProgress?.(line.trim());
        }
      }
    });

    const { stdout, stderr } = await subprocess;

    onProgress?.(`✅ Dependencies installed successfully!`);

    return {
      success: true,
      data: {
        projectName,
        packageManager,
        output: stdout || stderr || output,
      },
      message: `Successfully installed dependencies for '${projectName}' using ${packageManager}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to install dependencies: ${error.message}`,
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
export const installDepsToolDefinition: AnthropicTool = createToolDefinition({
  name: "install_deps",
  description:
    "Install dependencies in an MCP server project using a package manager (npm, yarn, or pnpm).",
  properties: {
    projectName: {
      type: "string",
      description: "Name of the MCP server project",
    },
    packageManager: {
      type: "string",
      enum: ["npm", "yarn", "pnpm"],
      description: "Package manager to use (default: yarn)",
      default: "yarn",
    },
  },
  required: ["projectName"],
});
