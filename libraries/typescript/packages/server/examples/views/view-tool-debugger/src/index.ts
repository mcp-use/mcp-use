/**
 * View Tool Debugger — an observable, intentionally stateful useViewTool example.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { randomUUID } from "node:crypto";

import { MCPServer } from "@mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "view-tool-debugger",
  version: "1.0.0",
  title: "View Tool Debugger",
  legacy: "stateless",
  logging: { level: "debug" },
  description:
    "Open a diagnostic view that exposes useViewTool registration, calls, state closures, results, and errors.",
  basePath: "/mcp",
});

const debuggerSessionSchema = z.object({
  sessionId: z.string(),
  label: z.string(),
  initialCounter: z.number().int(),
  openedAt: z.string(),
});

export const openViewToolDebugger = server.tool(
  {
    name: "open-view-tool-debugger",
    title: "Open the view-tool debugger",
    description:
      "Open a diagnostic MCP Apps view. Once it is visible, call its `debug-view-state` view tool to inspect live state, increment its counter, change its note, or exercise error paths.",
    inputSchema: z.object({
      label: z
        .string()
        .optional()
        .describe("Optional label shown throughout the debug session"),
      initialCounter: z
        .number()
        .int()
        .optional()
        .describe("Initial React counter value. Defaults to 0."),
    }),
    outputSchema: debuggerSessionSchema,
    view: {
      name: "view-tool-debugger",
      description: "Fully observable useViewTool diagnostic surface",
      prefersBorder: true,
    },
  },
  async ({ label = "untitled debug session", initialCounter = 0 }) => {
    const session = {
      sessionId: randomUUID(),
      label,
      initialCounter,
      openedAt: new Date().toISOString(),
    };

    return {
      content: [
        {
          type: "text",
          text: `Opened view-tool debugger session ${session.sessionId}. While the view is open, call \`debug-view-state\` with action \`inspect\` first.`,
        },
      ],
      structuredContent: session,
      _meta: {
        debugger: {
          receivedInput: { label, initialCounter },
          serverPid: process.pid,
          note: "This _meta object is view-only and appears in the tool-context panel.",
        },
      },
    };
  }
);

export default server;
