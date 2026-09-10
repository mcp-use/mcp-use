import { Daytona, type Sandbox } from "@daytona/sdk";
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "daytona-example",
  version: "1.0.0",
  description:
    "Run Python, TypeScript, or JavaScript in a fresh Daytona sandbox.",
});

/** Execute one code snippet and delete its isolated sandbox after the attempt. */
export const runCode = server.tool(
  {
    name: "run_code",
    description:
      "Execute Python, TypeScript, or JavaScript in a fresh Daytona sandbox. Returns output and exit code; files and state are discarded afterward.",
    inputSchema: z.object({
      code: z.string().min(1).max(100_000).describe("Source code to execute."),
      language: z
        .enum(["python", "typescript", "javascript"])
        .default("python"),
      timeoutSeconds: z.number().int().min(1).max(120).default(30),
    }),
  },
  async ({ code, language, timeoutSeconds }) => {
    if (!process.env.DAYTONA_API_KEY?.trim()) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Set DAYTONA_API_KEY in .env and restart the server before calling run_code.",
          },
        ],
      };
    }

    let daytona: Daytona | undefined;
    let sandbox: Sandbox | undefined;
    let output: string | undefined;
    let exitCode: number | undefined;
    let error: string | undefined;
    let cleanupError: string | undefined;
    try {
      daytona = new Daytona();
      // Auto-stop/delete also limits leftovers if the server exits unexpectedly.
      sandbox = await daytona.create(
        { language, autoStopInterval: 5, autoDeleteInterval: 0 },
        { timeout: 60 }
      );
      const result = await sandbox.process.codeRun(
        code,
        undefined,
        timeoutSeconds
      );
      output = result.result;
      exitCode = result.exitCode;
    } catch {
      // SDK errors can contain request details; do not expose credentials to clients.
      error =
        "Daytona could not create the sandbox or execute the code. Check your API key, Daytona quota and service availability, or increase timeoutSeconds (maximum 120).";
    } finally {
      if (daytona && sandbox) {
        try {
          await daytona.delete(sandbox, 30, true);
        } catch {
          cleanupError = `Could not confirm deletion of sandbox ${sandbox.id}. Check the Daytona dashboard and delete it if needed; automatic deletion is configured after stopping.`;
        }
      }
    }

    return {
      isError: Boolean(
        error || cleanupError || (exitCode !== undefined && exitCode !== 0)
      ),
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ output, exitCode, error, cleanupError }),
        },
      ],
    };
  }
);

/** Daytona cookbook server; the mcp-use CLI owns its HTTP listener. */
export default server;
