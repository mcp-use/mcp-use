import {
  createMCPServer,
  text,
  error,
} from "../../../../dist/src/server/index.js";
import { z } from "zod";

// Create an MCP server with elicitation support
const server = createMCPServer("elicitation-example-server", {
  version: "1.0.0",
  description:
    "An MCP server example demonstrating elicitation capabilities (form and URL modes)",
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * Example tool that uses form mode elicitation to collect user information.
 * This demonstrates the simplified API with Zod schema and automatic type inference.
 */
server.tool(
  {
    name: "collect-user-info",
    description:
      "Collect user information via form mode elicitation. Requires a client with elicitation support.",
  },
  async (params, ctx) => {
    try {
      // Simplified API: ctx.elicit(message, zodSchema)
      // Mode is automatically inferred from the Zod schema parameter
      const result = await ctx.elicit(
        "Please provide your information",
        z.object({
          name: z.string().describe("Your full name").default("Anonymous"),
          age: z
            .number()
            .describe("Your age in years")
            .min(0)
            .max(150)
            .default(0),
          email: z.string().email().describe("Your email address").optional(),
        })
      );

      // result.data is automatically typed as { name: string, age: number, email?: string }
      if (result.action === "accept") {
        return text(
          `✅ Information received:\n- Name: ${result.data.name}\n- Age: ${result.data.age}\n- Email: ${result.data.email || "Not provided"}`
        );
      } else if (result.action === "decline") {
        return text("❌ User declined to provide information");
      } else {
        return text("⚠️ Operation was cancelled");
      }
    } catch (err: any) {
      return error(`Error during elicitation: ${err.message || String(err)}`);
    }
  }
);

/**
 * Example tool for conformance testing - matches expected test names
 * Uses simplified API with Zod schema
 */
server.tool(
  {
    name: "test_elicitation",
    description:
      "A tool that uses elicitation to get user input (conformance test)",
  },
  async (params, ctx) => {
    try {
      // Simplified API with Zod schema
      const result = await ctx.elicit(
        "Please provide your information",
        z.object({
          name: z.string().default("Anonymous"),
          age: z.number().default(0),
        })
      );

      // result.data is typed as { name: string, age: number }
      if (result.action === "accept") {
        return text(`Received: ${result.data.name}, age ${result.data.age}`);
      } else if (result.action === "decline") {
        return text("User declined");
      }
      return text("Operation cancelled");
    } catch (err: any) {
      return error(`Elicitation error: ${err.message || String(err)}`);
    }
  }
);

/**
 * Example tool that demonstrates URL mode elicitation.
 * This would be used for sensitive operations like OAuth flows.
 *
 * Note: In a real implementation, the URL would direct users to an actual
 * OAuth authorization page or secure credential collection form.
 */
server.tool(
  {
    name: "authorize-service",
    description:
      "Authorize access to a service using URL mode elicitation (for demonstration purposes)",
    schema: z.object({
      serviceName: z.string().describe("Name of the service to authorize"),
    }),
  },
  async (params, ctx) => {
    try {
      // In a real implementation, this URL would be dynamically generated
      // and point to your OAuth authorization endpoint
      const authUrl = `https://example.com/oauth/authorize?service=${encodeURIComponent(params.serviceName)}&state=demo`;

      // Simplified API: ctx.elicit(message, url)
      // Mode is automatically inferred from the URL string parameter
      const result = await ctx.elicit(
        `Please authorize access to ${params.serviceName}`,
        authUrl
      );

      if (result.action === "accept") {
        return text(`✅ Authorization completed for ${params.serviceName}`);
      } else if (result.action === "decline") {
        return text(`❌ Authorization declined for ${params.serviceName}`);
      } else {
        return text(`⚠️ Authorization cancelled for ${params.serviceName}`);
      }
    } catch (err: any) {
      return error(`Error during authorization: ${err.message || String(err)}`);
    }
  }
);

/**
 * Validation test tool - demonstrates required field validation
 */
server.tool(
  {
    name: "test-required-validation",
    description: "Test required field validation without defaults",
  },
  async (params, ctx) => {
    try {
      // Schema with truly required fields (no defaults)
      const result = await ctx.elicit(
        "Please provide required information",
        z.object({
          username: z
            .string()
            .min(3)
            .describe("Username (required, min 3 chars)"),
          password: z
            .string()
            .min(8)
            .describe("Password (required, min 8 chars)"),
          confirmPassword: z.string().describe("Confirm password"),
        })
      );

      if (result.action === "accept") {
        // Validate passwords match (additional validation)
        if (result.data.password !== result.data.confirmPassword) {
          return error("❌ Passwords do not match");
        }

        return text(`✅ Account created for ${result.data.username}`);
      }

      return text("Account creation cancelled");
    } catch (err: any) {
      return error(`Validation error: ${err.message || String(err)}`);
    }
  }
);

// Start the server
await server.listen(PORT);
console.log(`🚀 Elicitation Example Server running on port ${PORT}`);
console.log(`📊 Inspector available at http://localhost:${PORT}/inspector`);
console.log(`🔧 MCP endpoint at http://localhost:${PORT}/mcp`);
console.log(`
💡 This server requires a client with elicitation support to use the tools.

📝 Elicitation Modes:
   - Form mode: Collects structured data with JSON schema validation
   - URL mode: Directs users to external URLs for sensitive interactions
   
⚠️  Important: Use URL mode for sensitive data like credentials and API keys!
`);
