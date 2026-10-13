import * as Sentry from "@sentry/node";
import { MCPServer } from "mcp-use";
import { z } from "zod";

Sentry.init({
  dsn: process.env.MCP_USE_SENTRY_DSN,
  tracesSampleRate: 1.0,
  sendDefaultPii: false,
  // Explicit instrumentation keeps this recipe focused on MCP tool calls.
  defaultIntegrations: false,
});

const server = new MCPServer({
  name: "sentry-example",
  version: "1.0.0",
  description: "Trace a successful tool call, a tool error, or an exception.",
});

server.use("mcp:tools/call", (ctx, next) =>
  Sentry.withIsolationScope((scope) => {
    const toolName = ctx.params.name;
    scope.setTag("mcp.tool.name", toolName);

    return Sentry.startSpan(
      {
        name: `tools/call ${toolName}`,
        op: "mcp.server",
        attributes: {
          "mcp.method.name": "tools/call",
          "mcp.tool.name": toolName,
        },
      },
      async (span) => {
        try {
          const result = await next();
          if ("isError" in result && result.isError === true) {
            span.setStatus({ code: 2, message: "internal_error" });
            span.setAttribute("mcp.tool.is_error", true);
            // Capture a stable message, not potentially sensitive tool output.
            Sentry.captureMessage(
              `MCP tool returned an error: ${toolName}`,
              "error"
            );
          } else {
            span.setStatus({ code: 1 });
          }
          return result;
        } catch (error) {
          span.setStatus({ code: 2, message: "internal_error" });
          Sentry.captureException(error);
          // Preserve normal MCP error handling instead of hiding the failure.
          throw error;
        }
      }
    );
  })
);

/** Exercise success, returned tool errors, and thrown exceptions in Inspector. */
export const monitoredReport = server.tool(
  {
    name: "monitored_report",
    description:
      "Generate a sample report or deliberately fail to test Sentry.",
    inputSchema: z.object({
      outcome: z
        .enum(["success", "tool_error", "exception"])
        .default("success"),
    }),
  },
  async ({ outcome }) => {
    if (outcome === "exception") {
      throw new Error("Demo report service unavailable");
    }
    if (outcome === "tool_error") {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Demo report could not be generated.",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: "Report generated: 3 orders, total $60.",
        },
      ],
    };
  }
);

/** Sentry example server; the mcp-use CLI owns its HTTP listener. */
export default server;
