import {
  MCPServer,
  // Response helpers — every one gets at least one callsite
  text,
  object,
  markdown,
  error,
  mix,
  image,
  html,
  xml,
  css,
  javascript,
  binary,
  audio,
  array,
  resource,
  widget,
  // Completion helper
  completable,
} from "mcp-use/server";
import { z } from "zod";

// ============================================================================
// MOCK DATA — shared across tools, resources, and prompts
// ============================================================================

const users = new Map([
  [
    "user-1",
    {
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      role: "admin",
      createdAt: "2024-01-15",
    },
  ],
  [
    "user-2",
    {
      id: "user-2",
      name: "Bob",
      email: "bob@example.com",
      role: "user",
      createdAt: "2024-02-20",
    },
  ],
  [
    "user-3",
    {
      id: "user-3",
      name: "Carol",
      email: "carol@example.com",
      role: "user",
      createdAt: "2024-03-10",
    },
  ],
]);

const items = new Map([
  [
    "item-1",
    { id: "item-1", name: "Widget Pro", category: "widgets", price: 29.99 },
  ],
  [
    "item-2",
    { id: "item-2", name: "Gadget Plus", category: "gadgets", price: 49.99 },
  ],
  [
    "item-3",
    { id: "item-3", name: "Tool Kit", category: "tools", price: 19.99 },
  ],
]);

const cache = new Map<
  string,
  { data: Record<string, unknown>; expires: number }
>();

const appSettings = {
  theme: "dark" as const,
  version: "1.0.0",
  language: "en",
  features: { notifications: true, analytics: false },
};

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

const server = new MCPServer({
  name: "everything-server",
  title: "Everything Server",
  version: "1.0.0",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
});

// ============================================================================
// MIDDLEWARE — server.use() with Hono-style and package-based middleware
// ============================================================================

// Concept: Logging middleware
server.use(async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} - ${Date.now() - start}ms`);
});

// Concept: Error handling middleware
server.use(async (c, next) => {
  try {
    await next();
  } catch (err) {
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Concept: Custom HTTP endpoint via server.app
server.app.get("/health", (c) =>
  c.json({ status: "ok", uptime: process.uptime() })
);
server.app.get("/api/version", (c) => c.json({ version: appSettings.version }));

// ============================================================================
// TOOL: No-schema (empty input)
// Tests: tool with z.object({}) — no parameters
// ============================================================================

server.tool(
  {
    name: "server-status",
    description: "Get current server status with no input required",
    schema: z.object({}),
  },
  async () => {
    return object({
      uptime: process.uptime(),
      users: users.size,
      items: items.size,
      timestamp: new Date().toISOString(),
    });
  }
);

// ============================================================================
// TOOL: Basic with schema + .describe()
// Tests: z.string, z.boolean, .optional(), .default(), .describe()
// ============================================================================

server.tool(
  {
    name: "greet-user",
    description: "Greet a user by name",
    schema: z.object({
      name: z.string().describe("User's name"),
      formal: z
        .boolean()
        .optional()
        .default(false)
        .describe("Use formal greeting"),
    }),
  },
  async ({ name, formal }) => {
    const greeting = formal ? `Good day, ${name}.` : `Hey ${name}!`;
    return text(greeting);
  }
);

// ============================================================================
// TOOL: All annotation types
// Tests: destructiveHint, readOnlyHint, openWorldHint
// ============================================================================

server.tool(
  {
    name: "delete-item",
    description: "Delete an item permanently",
    schema: z.object({
      itemId: z.string().describe("Item ID to delete"),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      openWorldHint: false,
    },
  },
  async ({ itemId }) => {
    if (!items.has(itemId)) {
      return error(`Item not found: ${itemId}`);
    }
    const item = items.get(itemId);
    items.delete(itemId);
    return text(`Deleted: ${item?.name}`);
  }
);

server.tool(
  {
    name: "list-items",
    description: "List all items (read-only, safe to call repeatedly)",
    schema: z.object({
      category: z
        .enum(["widgets", "gadgets", "tools", "all"])
        .optional()
        .default("all")
        .describe("Filter by category"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ category }) => {
    let result = Array.from(items.values());
    if (category !== "all") {
      result = result.filter((i) => i.category === category);
    }
    return object({ count: result.length, items: result });
  }
);

// ============================================================================
// TOOL: Context — progress reporting + logging
// Tests: ctx.reportProgress(), ctx.log()
// KNOWN ISSUE: object() inside mix() — TypedCallToolResult<T> is not
// assignable to CallToolResult parameter of mix(). PR pending.
// ============================================================================

server.tool(
  {
    name: "process-file",
    description:
      "Process a file with progress reporting and structured logging",
    schema: z.object({
      fileUrl: z.string().url().describe("URL of the file to process"),
      operation: z
        .enum(["analyze", "compress", "convert"])
        .describe("Operation type"),
    }),
  },
  async ({ fileUrl, operation }, ctx) => {
    await ctx.reportProgress?.(0, 100, "Starting...");
    await ctx.log("info", `Processing ${operation} for ${fileUrl}`);

    await ctx.reportProgress?.(50, 100, "Halfway...");
    await new Promise((r) => setTimeout(r, 100));
    await ctx.log("debug", "Processing chunk", "file-processor");

    await ctx.reportProgress?.(100, 100, "Done");
    await ctx.log("info", "Completed successfully");

    return mix(
      text(`Processed ${fileUrl}`),
      object({ operation, status: "success", duration: "100ms" })
    );
  }
);

// ============================================================================
// TOOL: Context — sampling + client capability check
// Tests: ctx.sample(), ctx.client.can(), ctx.client.capabilities()
// ============================================================================

server.tool(
  {
    name: "ai-summarize",
    description: "Summarize text using AI sampling if available",
    schema: z.object({
      content: z.string().describe("Text to summarize"),
    }),
  },
  async ({ content }, ctx) => {
    if (ctx.client.can("sampling")) {
      await ctx.log("info", "Client supports sampling");
      const result = await ctx.sample(`Summarize: ${content}`, {
        maxTokens: 200,
      });
      return text(
        typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content)
      );
    }

    await ctx.log("info", "No sampling support, returning truncated content");
    const caps = ctx.client.capabilities();
    return object({
      summary: content.substring(0, 100) + "...",
      samplingAvailable: false,
      clientCapabilities: Object.keys(caps),
    });
  }
);

// ============================================================================
// TOOL: Context — elicitation
// Tests: ctx.elicit() with form schema, ctx.client.can("elicitation")
// ============================================================================

server.tool(
  {
    name: "collect-feedback",
    description: "Collect user feedback via elicitation",
    schema: z.object({
      topic: z.string().describe("Topic to get feedback on"),
    }),
  },
  async ({ topic }, ctx) => {
    if (!ctx.client.can("elicitation")) {
      return error("Client does not support elicitation");
    }

    const result = await ctx.elicit(
      `Please provide feedback on: ${topic}`,
      z.object({
        rating: z.number().default(5),
        comment: z.string().default(""),
      })
    );

    if (result.action === "accept" && result.data) {
      return object({
        topic,
        rating: result.data.rating,
        comment: result.data.comment,
      });
    }

    return text("Feedback collection cancelled");
  }
);

// ============================================================================
// TOOL: Context — session + notifications
// Tests: ctx.session.sessionId, ctx.sendNotification()
// ============================================================================

server.tool(
  {
    name: "notify-session",
    description: "Send a notification to the current session",
    schema: z.object({
      message: z.string().describe("Notification message"),
    }),
  },
  async ({ message }, ctx) => {
    const sessionId = ctx.session.sessionId;
    await ctx.sendNotification("custom/alert", {
      message,
      timestamp: Date.now(),
    });
    return text(`Notification sent to session ${sessionId}`);
  }
);

// ============================================================================
// TOOL: outputSchema + error()
// Tests: outputSchema with typed structured output.
// KNOWN ISSUE: error() returns CallToolResult whose structuredContent is
// { [key: string]: unknown }, which is incompatible with the specific
// TypedCallToolResult<T> required by outputSchema. PR pending to fix
// error() return type to TypedCallToolResult<never>.
// ============================================================================

server.tool(
  {
    name: "calculate-stats",
    description: "Calculate statistics with validated output structure",
    schema: z.object({
      numbers: z.array(z.number()).min(1).describe("Numbers to analyze"),
    }),
    outputSchema: z.object({
      count: z.number(),
      sum: z.number(),
      mean: z.number(),
      min: z.number(),
      max: z.number(),
    }),
  },
  async ({ numbers }) => {
    if (numbers.length === 0) {
      return error("Cannot calculate statistics on empty array");
    }
    const sorted = [...numbers].sort((a, b) => a - b);
    const sum = numbers.reduce((a, b) => a + b, 0);
    return object({
      count: numbers.length,
      sum,
      mean: sum / numbers.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
    });
  }
);

// ============================================================================
// TOOL: Widget config + widget() return
// Tests: widget: { name, invoking, invoked }, widget({ props, output })
// Paired with resources/everything-widget.tsx
// ============================================================================

server.tool(
  {
    name: "browse-items",
    description: "Browse items with a visual widget interface",
    schema: z.object({
      query: z.string().optional().describe("Optional search query"),
    }),
    widget: {
      name: "everything-widget",
      invoking: "Loading items...",
      invoked: "Items loaded",
    },
  },
  async ({ query }) => {
    let results = Array.from(items.values());
    if (query) {
      const q = query.toLowerCase();
      results = results.filter((i) => i.name.toLowerCase().includes(q));
    }
    const categories = [...new Set(results.map((i) => i.category))];
    return widget({
      props: { items: results, categories, totalCount: results.length },
      output: text(
        `Found ${results.length} items across ${categories.length} categories`
      ),
    });
  }
);

// ============================================================================
// TOOL: Open-world + environment variables
// Tests: openWorldHint, process.env check, error() for missing config
// ============================================================================

server.tool(
  {
    name: "fetch-weather",
    description: "Fetch weather from external API (requires WEATHER_API_KEY)",
    schema: z.object({
      city: z.string().describe("City name"),
      units: z
        .enum(["celsius", "fahrenheit"])
        .optional()
        .default("celsius")
        .describe("Temperature units"),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  async ({ city, units }) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) {
      return error("WEATHER_API_KEY not configured. Set it in your .env file.");
    }
    return object({
      city,
      temperature: units === "celsius" ? 22 : 72,
      units,
      conditions: "Partly cloudy",
    });
  }
);

// ============================================================================
// TOOL: Caching pattern
// Tests: Map-based cache with TTL, forceRefresh bypass
// ============================================================================

server.tool(
  {
    name: "get-cached-data",
    description: "Fetch data with caching (5-minute TTL)",
    schema: z.object({
      key: z.string().describe("Cache key"),
      forceRefresh: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass cache"),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ key, forceRefresh }) => {
    const cacheKey = `data:${key}`;
    const ttl = 5 * 60 * 1000;

    if (!forceRefresh) {
      const cached = cache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return object({ ...cached.data, cached: true });
      }
    }

    const freshData = {
      key,
      value: Math.random(),
      computedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { data: freshData, expires: Date.now() + ttl });
    return object({ ...freshData, cached: false });
  }
);

// ============================================================================
// TOOL: Kitchen-sink Zod schema
// Tests: z.string, z.number, z.boolean, z.enum, z.array, z.object (nested),
//        z.record, .optional(), .default(), .min(), .max(), .email(), .url(),
//        .describe() on every field
// ============================================================================

server.tool(
  {
    name: "kitchen-sink-schema",
    description:
      "Tool exercising all common Zod schema types for type-checking coverage",
    schema: z.object({
      name: z
        .string()
        .min(1)
        .max(100)
        .describe("A required string with length constraints"),
      email: z.string().email().describe("A valid email address"),
      website: z.string().url().optional().describe("An optional valid URL"),
      age: z
        .number()
        .min(0)
        .max(150)
        .describe("A number with range constraints"),
      isActive: z.boolean().describe("A required boolean"),
      role: z.enum(["admin", "user", "guest"]).describe("An enum selection"),
      tags: z.array(z.string()).describe("An array of strings"),
      scores: z
        .array(z.number().min(0).max(100))
        .optional()
        .default([])
        .describe("Optional array of numbers with defaults"),
      address: z
        .object({
          street: z.string().describe("Street name"),
          city: z.string().describe("City name"),
          zip: z.string().optional().describe("Optional zip code"),
        })
        .describe("A nested object"),
      metadata: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional record/dictionary of string values"),
      priority: z
        .enum(["low", "medium", "high"])
        .optional()
        .default("medium")
        .describe("Optional enum with default"),
    }),
  },
  async ({
    name,
    email,
    website,
    age,
    isActive,
    role,
    tags,
    scores,
    address,
    metadata,
    priority,
  }) => {
    return object({
      received: {
        name,
        email,
        website,
        age,
        isActive,
        role,
        tagCount: tags.length,
        scoreCount: scores.length,
        city: address.city,
        metadataKeys: metadata ? Object.keys(metadata) : [],
        priority,
      },
    });
  }
);

// ============================================================================
// RESPONSE HELPER TOOLS — one tool per helper to exercise every type signature
// ============================================================================

// Helper: markdown()
server.tool(
  {
    name: "get-report",
    description: "Generate a markdown report",
    schema: z.object({
      title: z.string().describe("Report title"),
    }),
  },
  async ({ title }) => {
    return markdown(
      `# ${title}\n\n## Summary\n\n- Items: ${items.size}\n- Users: ${users.size}\n\n| Metric | Value |\n|--------|-------|\n| Uptime | ${process.uptime().toFixed(0)}s |`
    );
  }
);

// Helper: image()
server.tool(
  {
    name: "get-placeholder-image",
    description: "Return a placeholder image URL",
    schema: z.object({
      size: z
        .number()
        .min(50)
        .max(500)
        .optional()
        .default(200)
        .describe("Image size in pixels"),
    }),
  },
  async ({ size }) => {
    return image(`https://via.placeholder.com/${size}`, "image/png");
  }
);

// Helper: html()
server.tool(
  {
    name: "get-html-snippet",
    description: "Return an HTML snippet",
    schema: z.object({}),
  },
  async () => {
    return html(
      "<h1>Hello</h1><p>This is an HTML response from an MCP tool.</p>"
    );
  }
);

// Helper: xml()
server.tool(
  {
    name: "get-xml-data",
    description: "Return XML data",
    schema: z.object({}),
  },
  async () => {
    return xml('<?xml version="1.0"?><root><item id="1">Test</item></root>');
  }
);

// Helper: css()
server.tool(
  {
    name: "get-theme-css",
    description: "Return CSS theme styles",
    schema: z.object({}),
  },
  async () => {
    return css(
      "body { margin: 0; font-family: system-ui; } .card { padding: 16px; border-radius: 8px; }"
    );
  }
);

// Helper: javascript()
server.tool(
  {
    name: "get-script",
    description: "Return a JavaScript snippet",
    schema: z.object({}),
  },
  async () => {
    return javascript('console.log("Hello from MCP tool");');
  }
);

// Helper: binary()
server.tool(
  {
    name: "get-binary-data",
    description: "Return binary data as base64",
    schema: z.object({}),
  },
  async () => {
    const base64 = Buffer.from("Hello binary world").toString("base64");
    return binary(base64, "application/octet-stream");
  }
);

// Helper: audio()
server.tool(
  {
    name: "get-audio-sample",
    description: "Return a mock audio sample",
    schema: z.object({}),
  },
  async () => {
    const base64 = Buffer.from("fake-audio-data").toString("base64");
    return audio(base64, "audio/wav");
  }
);

// Helper: array()
server.tool(
  {
    name: "get-number-list",
    description: "Return an array of numbers",
    schema: z.object({
      count: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("How many numbers"),
    }),
  },
  async ({ count }) => {
    const nums = Array.from({ length: count }, (_, i) => i + 1);
    return array(nums);
  }
);

// Helper: resource() embedding
server.tool(
  {
    name: "get-help",
    description: "Return help docs with embedded resource reference",
    schema: z.object({
      topic: z.enum(["api", "auth"]).describe("Help topic"),
    }),
  },
  async ({ topic }) => {
    return mix(
      text(`Help for: ${topic}`),
      resource(`docs://${topic}`, "text/markdown")
    );
  }
);

// Helper: mix() with every response helper type in a single call
// KNOWN ISSUE: object() inside mix() — TypedCallToolResult vs CallToolResult. PR pending.
server.tool(
  {
    name: "all-helpers-mix",
    description: "Return a mix of every response helper type in one call",
    schema: z.object({}),
  },
  async () => {
    const audioResult = await audio(
      Buffer.from("fake").toString("base64"),
      "audio/wav"
    );
    return mix(
      text("Plain text"),
      markdown("## Markdown heading"),
      html("<p>HTML paragraph</p>"),
      xml("<item>XML</item>"),
      css("body { margin: 0; }"),
      javascript('console.log("js");'),
      image("https://via.placeholder.com/100", "image/png"),
      binary(
        Buffer.from("bytes").toString("base64"),
        "application/octet-stream"
      ),
      audioResult,
      object({ key: "value" }),
      resource("docs://api", "text/markdown")
    );
  }
);

// ============================================================================
// RESOURCES — static, dynamic, cached, and templated
// ============================================================================

// Static resource: application/json
server.resource(
  {
    name: "app_settings",
    uri: "config://settings",
    title: "Application Settings",
    description: "Current server configuration as JSON",
    mimeType: "application/json",
  },
  async () => {
    return object({
      ...appSettings,
      timestamp: new Date().toISOString(),
    });
  }
);

// Static resource: text/plain
server.resource(
  {
    name: "server_motd",
    uri: "info://motd",
    title: "Message of the Day",
    description: "Plain text message of the day",
    mimeType: "text/plain",
  },
  async () => {
    return text("Welcome to the Everything Server. All systems operational.");
  }
);

// Static resource: text/markdown
server.resource(
  {
    name: "api_docs",
    uri: "docs://api",
    title: "API Documentation",
    description: "API documentation in markdown format",
    mimeType: "text/markdown",
  },
  async () => {
    return markdown(
      "# API Docs\n\n## Endpoints\n\n- `GET /health` - Health check\n- `GET /api/version` - Server version"
    );
  }
);

// Dynamic resource: computed at request time
server.resource(
  {
    name: "server_stats",
    uri: "stats://live",
    title: "Live Server Stats",
    description: "Real-time server statistics computed on each request",
    mimeType: "application/json",
  },
  async () => {
    return object({
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage().heapUsed,
      userCount: users.size,
      itemCount: items.size,
      cacheSize: cache.size,
      timestamp: new Date().toISOString(),
    });
  }
);

// Cached resource with TTL
server.resource(
  {
    name: "expensive_report",
    uri: "stats://expensive",
    title: "Expensive Report",
    description: "Computationally expensive report cached for 10 minutes",
    mimeType: "application/json",
  },
  async () => {
    const cacheKey = "resource:expensive-report";
    const ttl = 10 * 60 * 1000;

    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return object({ ...cached.data, cached: true });
    }

    const report = {
      totalUsers: users.size,
      totalItems: items.size,
      computedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, { data: report, expires: Date.now() + ttl });
    return object({ ...report, cached: false });
  }
);

// Resource template with static completion
server.resourceTemplate(
  {
    name: "documentation",
    uriTemplate: "docs://{topic}",
    title: "Documentation",
    description: "Get documentation by topic",
    mimeType: "text/markdown",
    callbacks: {
      complete: {
        topic: ["api", "auth", "getting-started", "troubleshooting"],
      },
    },
  },
  async (uri: URL, params: Record<string, string>) => {
    const docs: Record<string, string> = {
      api: "# API Docs\n\nREST endpoints for managing resources.",
      auth: "# Auth Guide\n\nUse API keys via the Authorization header.",
      "getting-started":
        "# Getting Started\n\n1. Install\n2. Configure\n3. Run",
      troubleshooting:
        "# Troubleshooting\n\n## Common Issues\n\n- Check logs\n- Verify config",
    };

    const content = docs[params.topic];
    if (!content) {
      return error(`Topic not found: ${params.topic}`);
    }
    return markdown(content);
  }
);

// Resource template with dynamic async completion
server.resourceTemplate(
  {
    name: "user_profile",
    uriTemplate: "user://{userId}/profile",
    title: "User Profile",
    description: "Get user profile by ID with autocomplete",
    mimeType: "application/json",
    callbacks: {
      complete: {
        userId: async (value: string) => {
          return Array.from(users.keys()).filter((id) => id.startsWith(value));
        },
      },
    },
  },
  async (uri: URL, params: Record<string, string>) => {
    const user = users.get(params.userId);
    if (!user) {
      return error(`User not found: ${params.userId}`);
    }
    return object({
      ...user,
      profileUrl: `user://${params.userId}/profile`,
    });
  }
);

// ============================================================================
// PROMPTS — basic, completable static, completable dynamic, markdown return
// ============================================================================

// Basic prompt with schema
server.prompt(
  {
    name: "summarize",
    description: "Generate a summarization prompt",
    schema: z.object({
      content: z.string().describe("Content to summarize"),
      maxLength: z
        .number()
        .optional()
        .default(100)
        .describe("Max summary length in words"),
    }),
  },
  async ({ content, maxLength }) => {
    return text(
      `Please summarize the following in ${maxLength} words or fewer:\n\n${content}`
    );
  }
);

// Prompt with completable() static list
server.prompt(
  {
    name: "code-review",
    description: "Generate a code review prompt with language autocomplete",
    schema: z.object({
      language: completable(z.string().describe("Programming language"), [
        "TypeScript",
        "JavaScript",
        "Python",
        "Go",
        "Rust",
        "Java",
      ]),
      code: z.string().describe("Code to review"),
      focus: z
        .enum(["security", "performance", "style", "all"])
        .optional()
        .default("all")
        .describe("Review focus area"),
    }),
  },
  async ({ language, code, focus }) => {
    return markdown(
      `# Code Review: ${language}\n\n## Focus: ${focus}\n\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\`\n\n` +
        "Review for correctness, bugs, error handling, and best practices."
    );
  }
);

// Prompt with completable() dynamic + ctx.arguments
server.prompt(
  {
    name: "user-report",
    description:
      "Generate a report prompt for a specific user with contextual completion",
    schema: z.object({
      userId: completable(
        z.string().describe("User ID to generate report for"),
        async (value: string) => {
          return Array.from(users.keys()).filter((id) => id.startsWith(value));
        }
      ),
      reportType: completable(
        z.string().describe("Type of report"),
        async (value: string, ctx) => {
          const userId = ctx?.arguments?.userId as string | undefined;
          const user = userId ? users.get(userId) : undefined;
          const types = ["activity", "security", "usage"];
          if (user?.role === "admin") types.push("admin-audit");
          return types.filter((t) => t.startsWith(value));
        }
      ),
    }),
  },
  async ({ userId, reportType }) => {
    const user = users.get(userId);
    const name = user?.name || "Unknown User";
    return markdown(
      `# ${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report\n\n` +
        `**User:** ${name} (${userId})\n\n` +
        `Generate a comprehensive ${reportType} report for this user.`
    );
  }
);

// ============================================================================
// START SERVER
// ============================================================================

server.listen();
