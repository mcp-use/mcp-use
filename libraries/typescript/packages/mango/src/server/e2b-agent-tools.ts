/**
 * Custom tools for Agent SDK that execute in E2B sandbox
 * These wrap E2B file/command operations as MCP tools
 */
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Sandbox } from "@e2b/code-interpreter";

/**
 * Create MCP server with tools that execute in E2B sandbox
 */
export function createE2BSandboxTools(sandbox: Sandbox) {
  // Read file tool
  const readFileTool = tool(
    "read_file_sandbox",
    "Read a file from the E2B sandbox project at /home/user/mcp-project",
    {
      path: z.string().describe("Relative path from /home/user/mcp-project"),
    },
    async (args) => {
      try {
        const fullPath = `/home/user/mcp-project/${args.path}`;
        const content = await sandbox.files.read(fullPath);
        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading file: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Write file tool
  const writeFileTool = tool(
    "write_file_sandbox",
    "Write or overwrite a file in the E2B sandbox project",
    {
      path: z.string().describe("Relative path from /home/user/mcp-project"),
      content: z.string().describe("File content to write"),
    },
    async (args) => {
      try {
        const fullPath = `/home/user/mcp-project/${args.path}`;
        await sandbox.files.write(fullPath, args.content);
        return {
          content: [
            {
              type: "text",
              text: `Successfully wrote ${args.content.length} bytes to ${args.path}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error writing file: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Execute command tool
  const execCommandTool = tool(
    "exec_command_sandbox",
    "Execute a shell command in the E2B sandbox",
    {
      command: z.string().describe("Shell command to execute"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to /home/user/mcp-project)"),
    },
    async (args) => {
      try {
        const result = await sandbox.commands.run(args.command, {
          workDir: args.cwd || "/home/user/mcp-project",
        });
        return {
          content: [
            {
              type: "text",
              text: `Exit code: ${result.exitCode}\n\nOutput:\n${result.stdout}\n\nErrors:\n${result.stderr}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing command: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // List files tool
  const listFilesTool = tool(
    "list_files_sandbox",
    "List files in the E2B sandbox project directory",
    {
      path: z
        .string()
        .optional()
        .describe(
          "Relative path from /home/user/mcp-project (defaults to root)"
        ),
    },
    async (args) => {
      try {
        const dirPath = `/home/user/mcp-project/${args.path || ""}`;
        const result = await sandbox.commands.run(`ls -la ${dirPath}`);
        return {
          content: [
            {
              type: "text",
              text: result.stdout,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing files: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Create and return the MCP server
  return createSdkMcpServer({
    name: "e2b-sandbox",
    version: "1.0.0",
    tools: [readFileTool, writeFileTool, execCommandTool, listFilesTool],
  });
}
