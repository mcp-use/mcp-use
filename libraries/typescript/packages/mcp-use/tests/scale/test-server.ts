/**
 * Comprehensive MCP Test Server for Scale Testing
 *
 * Implements all MCP features for testing under load:
 * - Tools (fast, slow, I/O-bound)
 * - Resources (static, dynamic)
 * - Prompts
 * - Notifications (tools/resources/prompts list changes)
 * - Sampling (server-to-client LLM requests)
 * - Elicitation (server-to-client user input requests)
 *
 * Run with:
 *   npx tsx tests/scale/test-server.ts
 *
 * Or with Redis:
 *   REDIS_URL=redis://... npx tsx tests/scale/test-server.ts
 */

import { MCPServer } from "../../src/server/mcp-server.js";
import { RedisSessionStore } from "../../src/server/sessions/stores/redis.js";
import { RedisStreamManager } from "../../src/server/sessions/streams/redis.js";
import { text, object } from "../../src/server/utils/response-helpers.js";
import { z } from "zod";
import { createClient } from "redis";

/**
 * Create a fully-featured MCP test server
 */
export async function createTestServer(port: number, redisUrl?: string) {
  let redis: any;
  let pubSubRedis: any;
  let sessionStore;
  let streamManager;

  // Configure Redis if URL provided
  if (redisUrl) {
    console.log(
      `[TestServer] Connecting to Redis: ${redisUrl.replace(/\/\/.*@/, "//<credentials>@")}`
    );
    redis = createClient({ url: redisUrl });
    pubSubRedis = redis.duplicate();

    await redis.connect();
    await pubSubRedis.connect();

    sessionStore = new RedisSessionStore({
      client: redis,
      prefix: "test:mcp:session:",
      defaultTTL: 3600,
    });

    streamManager = new RedisStreamManager({
      client: redis,
      pubSubClient: pubSubRedis,
      prefix: "test:mcp:stream:",
      heartbeatInterval: 10,
    });

    console.log(
      "[TestServer] Redis connected - using distributed session management"
    );
  }

  const server = new MCPServer({
    name: "scale-test-server",
    version: "1.0.0",
    description: "Comprehensive test server for scale and load testing",
    sessionStore,
    streamManager,
  });

  // ========== TOOLS ==========

  // Fast tool: minimal processing
  server.tool(
    {
      name: "fast-echo",
      description: "Echo a message back with minimal processing",
      schema: z.object({
        message: z.string().describe("Message to echo back"),
      }),
    },
    async ({ message }) => {
      return text(`Echo: ${message}`);
    }
  );

  // CPU-intensive tool
  server.tool(
    {
      name: "slow-computation",
      description: "CPU-intensive computation for load testing",
      schema: z.object({
        iterations: z
          .number()
          .min(1)
          .max(1000000)
          .describe("Number of iterations to compute"),
      }),
    },
    async ({ iterations }) => {
      const start = Date.now();
      let result = 0;

      // Simulate CPU-intensive work
      for (let i = 0; i < iterations; i++) {
        result += Math.sqrt(i);
      }

      const duration = Date.now() - start;

      return object({
        result,
        iterations,
        durationMs: duration,
        throughput: iterations / (duration / 1000),
      });
    }
  );

  // I/O-bound tool
  server.tool(
    {
      name: "fetch-data",
      description: "I/O-bound data fetching simulation",
      schema: z.object({
        url: z.string().url().describe("URL to fetch"),
        delay: z.number().optional().describe("Simulated delay in ms"),
      }),
    },
    async ({ url, delay = 100 }) => {
      const start = Date.now();

      // Simulate async I/O operation
      await new Promise((resolve) => setTimeout(resolve, delay));

      return object({
        url,
        data: "Fetched successfully",
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      });
    }
  );

  // Tool that triggers notifications
  server.tool(
    {
      name: "trigger-notification",
      description: "Trigger notifications to test delivery",
      schema: z.object({
        type: z
          .enum(["tools", "resources", "prompts", "custom"])
          .describe("Type of notification to send"),
        message: z
          .string()
          .optional()
          .describe("Custom message for custom notifications"),
      }),
    },
    async ({ type, message }) => {
      const sessions = server.getActiveSessions();

      if (type === "tools") {
        await server.sendToolsListChanged();
      } else if (type === "resources") {
        await server.sendResourcesListChanged();
      } else if (type === "prompts") {
        await server.sendPromptsListChanged();
      } else if (type === "custom") {
        await server.sendNotification("custom/test", {
          message: message || "Test notification",
          timestamp: Date.now(),
        });
      }

      return text(`Sent ${type} notification to ${sessions.length} client(s)`);
    }
  );

  // Tool that uses sampling (if client supports it)
  server.tool(
    {
      name: "request-sampling",
      description: "Request LLM sampling from client",
      schema: z.object({
        prompt: z.string().describe("Prompt to send to client LLM"),
        maxTokens: z.number().optional().describe("Maximum tokens to generate"),
      }),
    },
    async ({ prompt, maxTokens = 100 }, ctx) => {
      if (!ctx.sample) {
        return text("Client does not support sampling capability");
      }

      try {
        const result = await ctx.sample({
          messages: [{ role: "user", content: { type: "text", text: prompt } }],
          maxTokens,
        });

        return object({
          success: true,
          response: result,
        });
      } catch (error: any) {
        return text(`Sampling failed: ${error.message}`);
      }
    }
  );

  // Tool that uses elicitation (if client supports it)
  server.tool(
    {
      name: "request-input",
      description: "Request user input via elicitation",
      schema: z.object({
        question: z.string().describe("Question to ask the user"),
        mode: z.enum(["url", "form"]).optional().describe("Elicitation mode"),
      }),
    },
    async ({ question, mode = "url" }, ctx) => {
      if (!ctx.elicit) {
        return text("Client does not support elicitation capability");
      }

      try {
        const result = await ctx.elicit({
          mode,
          url: "https://example.com/input",
          title: "User Input Required",
          description: question,
        });

        return object({
          success: true,
          userInput: result,
        });
      } catch (error: any) {
        return text(`Elicitation failed: ${error.message}`);
      }
    }
  );

  // Get server stats
  server.tool(
    {
      name: "get-server-stats",
      description: "Get server statistics and health metrics",
    },
    async () => {
      return object({
        activeSessions: server.getActiveSessions().length,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: Date.now(),
      });
    }
  );

  // ========== RESOURCES ==========

  server.resource(
    {
      name: "static-data",
      uri: "app://static-data",
      description: "Static resource for testing",
    },
    async () => {
      return text("This is static resource data that never changes");
    }
  );

  server.resource(
    {
      name: "dynamic-data",
      uri: "app://dynamic-data",
      description: "Dynamic resource that changes on each read",
    },
    async () => {
      return object({
        timestamp: Date.now(),
        randomValue: Math.random(),
        serverUptime: process.uptime(),
        activeSessions: server.getActiveSessions().length,
      });
    }
  );

  server.resource(
    {
      name: "large-data",
      uri: "app://large-data",
      description: "Large resource for bandwidth testing",
    },
    async () => {
      // Generate 100KB of data
      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        data: "x".repeat(100),
        timestamp: Date.now(),
      }));

      return object({ items: largeData });
    }
  );

  // ========== PROMPTS ==========

  server.prompt(
    {
      name: "greeting",
      description: "Multi-language greeting template",
      schema: z.object({
        name: z.string().describe("Name to greet"),
        language: z
          .enum(["en", "es", "fr"])
          .optional()
          .describe("Language for greeting"),
      }),
    },
    async ({ name, language = "en" }) => {
      const greetings = {
        en: "Hello",
        es: "Hola",
        fr: "Bonjour",
      };

      return text(`${greetings[language]}, ${name}! This is a test prompt.`);
    }
  );

  server.prompt(
    {
      name: "code-review",
      description: "Code review template",
      schema: z.object({
        code: z.string().describe("Code to review"),
      }),
    },
    async ({ code }) => {
      return text(`Please review this code:\n\n\`\`\`\n${code}\n\`\`\``);
    }
  );

  // Start the server
  await server.listen(port);

  console.log(`
╔════════════════════════════════════════════════════════════╗
║            MCP Scale Test Server Running                   ║
╠════════════════════════════════════════════════════════════╣
║  Port: ${port}                                                 ║
║  Mode: ${redisUrl ? "Distributed (Redis)" : "Single Instance"}                            ║
║  MCP Endpoint: http://localhost:${port}/mcp                  ║
║  Inspector: http://localhost:${port}/inspector               ║
╠════════════════════════════════════════════════════════════╣
║  Tools:                                                    ║
║    - fast-echo: Minimal latency echo                       ║
║    - slow-computation: CPU-intensive                       ║
║    - fetch-data: I/O-bound simulation                      ║
║    - trigger-notification: Send notifications              ║
║    - request-sampling: Test sampling capability            ║
║    - request-input: Test elicitation capability            ║
║    - get-server-stats: Server metrics                      ║
║  Resources:                                                ║
║    - app://static-data: Static content                     ║
║    - app://dynamic-data: Dynamic content                   ║
║    - app://large-data: 100KB payload                       ║
║  Prompts:                                                  ║
║    - greeting: Simple greeting template                    ║
║    - code-review: Code review template                     ║
╚════════════════════════════════════════════════════════════╝
  `);

  return server;
}

// Run directly if executed as main script
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || "3000");
  const redisUrl = process.env.REDIS_URL;

  await createTestServer(port, redisUrl);

  console.log("Server ready for scale testing!");
  console.log("Press Ctrl+C to stop");
}
