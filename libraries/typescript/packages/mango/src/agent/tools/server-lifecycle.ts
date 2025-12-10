/**
 * Server lifecycle tools - Start and stop MCP servers
 */

import { StructuredTool } from "@langchain/core/tools";
import { execa } from "execa";
import { z } from "zod";
import type { WorkspaceManager } from "../../server/workspace.js";
import { ProcessManager } from "../../server/process-manager.js";

/**
 * InstallDependenciesTool - Install npm dependencies in a project
 */
export class InstallDependenciesTool extends StructuredTool {
  name = "install_dependencies";
  description = `Install or update npm dependencies in an MCP server project.
  Run this after creating a new project or when you've added new dependencies to package.json.
  This will run npm install in the project directory.`;

  schema = z.object({
    projectName: z.string().describe("Name of the MCP server project"),
  });

  private workspaceManager: WorkspaceManager;

  constructor(workspaceManager: WorkspaceManager) {
    super();
    this.workspaceManager = workspaceManager;
  }

  protected async _call({
    projectName,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const projectPath = this.workspaceManager.getProjectPath(projectName);

      const { stdout, stderr } = await execa("npm", ["install"], {
        cwd: projectPath,
        timeout: 300000, // 5 minute timeout
      });

      let result = `✅ Successfully installed dependencies for "${projectName}"\n\n`;

      if (stdout && stdout.trim()) {
        result += `Output:\n${stdout.trim()}\n\n`;
      }

      if (stderr && stderr.trim()) {
        result += `⚠️ Warnings:\n${stderr.trim()}`;
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to install dependencies: ${message}`);
    }
  }
}

/**
 * StartServerTool - Start an MCP server in development mode
 */
export class StartServerTool extends StructuredTool {
  name = "start_server";
  description = `Start an MCP server in development mode.
  The server will run on an available port and you'll receive the URL to connect to.
  Use this after creating or editing a server to test it.
  The server will continue running until you stop it with stop_server.`;

  schema = z.object({
    projectName: z.string().describe("Name of the MCP server project"),
    port: z
      .number()
      .optional()
      .describe("Port to run the server on (default: auto-assign)"),
  });

  private workspaceManager: WorkspaceManager;
  private processManager: ProcessManager;

  constructor(workspaceManager: WorkspaceManager) {
    super();
    this.workspaceManager = workspaceManager;
    this.processManager = ProcessManager.getInstance();
  }

  protected async _call({
    projectName,
    port,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Check if server is already running
      if (this.processManager.isServerRunning(projectName)) {
        const info = this.processManager.getServerInfo(projectName);
        return `⚠️ Server "${projectName}" is already running at ${info?.url}`;
      }

      const projectPath = this.workspaceManager.getProjectPath(projectName);

      // Find available port if not specified
      const serverPort =
        port || (await this.processManager.findAvailablePort());

      // Start the server using npm run dev
      const childProcess = execa("npm", ["run", "dev"], {
        cwd: projectPath,
        env: {
          ...process.env,
          PORT: String(serverPort),
          NODE_ENV: "development",
        },
        // Don't inherit stdio so we can capture output
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Register the process
      this.processManager.registerServer(projectName, childProcess, serverPort);

      // Wait a bit for server to start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if still running
      if (!this.processManager.isServerRunning(projectName)) {
        throw new Error("Server stopped unexpectedly after starting");
      }

      const serverUrl = `http://localhost:${serverPort}/mcp`;

      let result = `✅ Successfully started MCP server "${projectName}"\n\n`;
      result += `🌐 URL: ${serverUrl}\n`;
      result += `🔌 Port: ${serverPort}\n`;
      result += `📝 PID: ${childProcess.pid}\n\n`;
      result += `The server is now running and ready to accept connections.\n`;
      result += `Use this URL to connect from the inspector or test tools.`;

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start server: ${message}`);
    }
  }
}

/**
 * StopServerTool - Stop a running MCP server
 */
export class StopServerTool extends StructuredTool {
  name = "stop_server";
  description = `Stop a running MCP server.
  Use this when you want to stop a server that's currently running,
  for example before making changes or when testing is complete.`;

  schema = z.object({
    projectName: z.string().describe("Name of the MCP server project"),
  });

  private processManager: ProcessManager;

  constructor() {
    super();
    this.processManager = ProcessManager.getInstance();
  }

  protected async _call({
    projectName,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      if (!this.processManager.isServerRunning(projectName)) {
        return `⚠️ Server "${projectName}" is not running`;
      }

      const info = this.processManager.getServerInfo(projectName);
      const stopped = this.processManager.stopServer(projectName);

      if (stopped) {
        return `✅ Successfully stopped MCP server "${projectName}" (was running on port ${info?.port})`;
      } else {
        throw new Error("Failed to stop server process");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to stop server: ${message}`);
    }
  }
}
