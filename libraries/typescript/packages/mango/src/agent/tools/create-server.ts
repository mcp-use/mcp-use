/**
 * CreateServerTool - Wraps create-mcp-use-app CLI to scaffold new MCP servers
 */

import { StructuredTool } from "@langchain/core/tools";
import { execa } from "execa";
import { z } from "zod";
import type { WorkspaceManager } from "../../server/workspace.js";

export class CreateServerTool extends StructuredTool {
  name = "create_mcp_server";
  description = `Create a new MCP server project using create-mcp-use-app. 
  This scaffolds a complete MCP server with the chosen template.
  Templates:
  - starter: Full-featured template with examples of tools, resources, and both mcp-ui and apps-sdk
  - mcp-ui: Template focused on mcp-ui resources (React components)
  - apps-sdk: Template focused on OpenAI Apps SDK integration
  
  The server will be created in the workspace directory and dependencies will be automatically installed.`;

  schema = z.object({
    projectName: z
      .string()
      .describe(
        "Name of the MCP server project (alphanumeric, hyphens, underscores only)"
      ),
    template: z
      .enum(["starter", "mcp-ui", "apps-sdk"])
      .default("starter")
      .describe("Template to use for the server"),
  });

  private workspaceManager: WorkspaceManager;

  constructor(workspaceManager: WorkspaceManager) {
    super();
    this.workspaceManager = workspaceManager;
  }

  protected async _call({
    projectName,
    template,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Create project directory in workspace
      const projectPath = this.workspaceManager.createProjectDir(projectName);
      const workspaceDir = this.workspaceManager.getWorkspaceDir();

      // Run create-mcp-use-app CLI
      // We use npx to run the latest version
      const { stderr } = await execa(
        "npx",
        [
          "create-mcp-use-app",
          projectName,
          "--template",
          template,
          "--install",
          "--no-git", // Don't initialize git in workspace
        ],
        {
          cwd: workspaceDir,
          timeout: 300000, // 5 minute timeout for npm install
        }
      );

      // Get project info
      const projectInfo = this.workspaceManager.getProjectInfo(projectName);

      if (!projectInfo) {
        throw new Error("Project was created but could not be found");
      }

      let result = `✅ Successfully created MCP server "${projectName}" using ${template} template\n\n`;
      result += `📁 Location: ${projectPath}\n`;
      result += `📄 Files created: ${projectInfo.files.length}\n\n`;
      result += `Key files:\n`;

      // List key files
      const keyFiles = projectInfo.files.filter((f) =>
        ["index.ts", "package.json", "tsconfig.json", "README.md"].some((key) =>
          f.endsWith(key)
        )
      );
      result += keyFiles.map((f) => `  - ${f}`).join("\n");

      if (stderr && stderr.trim()) {
        result += `\n\n⚠️ Warnings:\n${stderr}`;
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create MCP server: ${message}`);
    }
  }
}
