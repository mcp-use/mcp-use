/**
 * Timeout Example for Elicitation
 *
 * Demonstrates configurable timeout behavior:
 * - Default: No timeout (waits indefinitely)
 * - Optional: Specify timeout in milliseconds
 */

import { MCPServer } from "../../../../dist/src/server/index.js";
import { z } from "zod";

const server = new MCPServer({
  name: "timeout-example",
  version: "1.0.0",
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003;

// Example 1: No timeout (default - waits indefinitely)
server.tool(
  {
    name: "collect-feedback",
    description: "Collect user feedback with no timeout",
    inputs: [],
  },
  async (params, ctx) => {
    // No timeout specified - waits indefinitely for user
    const result = await ctx.elicit(
      "Please provide your feedback (take your time)",
      z.object({
        rating: z.number().min(1).max(5),
        comment: z.string().optional(),
      })
    );

    if (result.action === "accept") {
      return {
        content: [
          {
            type: "text",
            text: `Thank you! Rating: ${result.data.rating}/5`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: "No feedback provided" }],
    };
  }
);

// Example 2: With timeout for time-sensitive operations
server.tool(
  {
    name: "quick-confirmation",
    description: "Quick confirmation with 30-second timeout",
    inputs: [],
  },
  async (params, ctx) => {
    try {
      // 30-second timeout for quick yes/no
      const result = await ctx.elicit(
        "Quick confirmation needed! (30 seconds)",
        z.object({
          confirmed: z.boolean().default(false),
        }),
        { timeout: 30000 } // 30 seconds
      );

      if (result.action === "accept") {
        return {
          content: [
            {
              type: "text",
              text: result.data.confirmed
                ? "✅ Confirmed!"
                : "❌ Not confirmed",
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text: "Operation cancelled" }],
      };
    } catch (error: any) {
      // Timeout or other error
      return {
        content: [
          {
            type: "text",
            text: `Timeout or error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Example 3: URL mode with timeout
server.tool(
  {
    name: "timed-authorization",
    description: "Authorization with 2-minute timeout",
    inputs: [],
  },
  async (params, ctx) => {
    try {
      const authUrl = "https://example.com/oauth/authorize";

      // 2-minute timeout for OAuth flow
      const result = await ctx.elicit(
        "Please complete authorization within 2 minutes",
        authUrl,
        { timeout: 120000 } // 2 minutes
      );

      if (result.action === "accept") {
        return {
          content: [{ type: "text", text: "✅ Authorization completed" }],
        };
      }

      return {
        content: [{ type: "text", text: "Authorization not completed" }],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Authorization failed: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

await server.listen(PORT);
console.log(`🚀 Timeout Example Server running on port ${PORT}`);
console.log(`📊 Inspector available at http://localhost:${PORT}/inspector`);
console.log(`
📝 Timeout Examples:
   - collect-feedback: No timeout (waits indefinitely)
   - quick-confirmation: 30-second timeout
   - timed-authorization: 2-minute timeout
   
💡 Default behavior: Like sampling, elicitation waits indefinitely by default.
   Set options.timeout to limit wait time.
`);
