import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "upstash-example",
  version: "1.0.0",
  description: "Generate a report with a shared Upstash rate limit.",
});

let limiter: Ratelimit | undefined;

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

server.use("mcp:tools/call", async (ctx, next) => {
  if (ctx.params.name !== "generate_report") return next();

  if (
    !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ) {
    return toolError(
      "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env and restart the server."
    );
  }

  // Only provider setup/checking belongs in this catch; tool errors should
  // retain their own meaning after next() runs.
  try {
    limiter ??= new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(3, "30 s"),
      prefix: "mcp-use:upstash-example",
      analytics: false,
      timeout: 3_000,
    });

    // All callers share this demo quota, including across server instances.
    // For per-customer limits, key by a verified user/tenant ID + tool name.
    const { success, reason, reset } = await limiter.limit("generate_report");

    // Upstash allows calls on timeout by default. This example fails closed.
    if (reason === "timeout") {
      return toolError("The quota check timed out. Please try again shortly.");
    }
    if (!success) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((reset - Date.now()) / 1_000)
      );
      return toolError(
        `Rate limit reached: 3 reports per 30 seconds, shared by all callers. Retry in about ${retryAfterSeconds} seconds.`
      );
    }
  } catch {
    // Redis errors may contain request details; never return them to clients.
    return toolError(
      "Could not check the quota. Check your Upstash credentials and service availability, then try again."
    );
  }

  return next();
});

/** Generate a local numeric report after the shared quota check succeeds. */
export const generateReport = server.tool(
  {
    name: "generate_report",
    description:
      "Summarize numeric values. Limited to 3 calls per 30 seconds across all callers; wait before retrying a rate-limit error.",
    inputSchema: z.object({
      values: z.array(z.number().min(-1e9).max(1e9)).min(1).max(1_000),
    }),
  },
  async ({ values }) => {
    // A fast local calculation keeps this demo independent of paid APIs.
    // Replace this callback with your expensive report or sandbox operation.
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            count: values.length,
            total,
            average: total / values.length,
            minimum: Math.min(...values),
            maximum: Math.max(...values),
          }),
        },
      ],
    };
  }
);

/** Upstash example server; the mcp-use CLI owns its HTTP listener. */
export default server;
