/**
 * MCP Conformance Test Server (TypeScript)
 *
 * Implements all supported MCP features for the inspector conformance suite.
 * Uses exact tool/resource/prompt names expected by e2e tests.
 *
 * Default-export the server; `mcp-use dev` / `build` / `start` own the socket.
 */
import { completable, inputRequired, inputResponse, MCPServer } from "mcp-use";
import { z } from "zod";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const RED_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const SILENT_WAV_BASE64 =
  "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAABAAgAZGF0YQIAAACA";

const STATIC_BINARY_BLOB = "AAECA//+/Q==";

const weatherOutputSchema = z.object({
  city: z.string(),
  temperature: z.number(),
  conditions: z.string(),
  humidity: z.number(),
  windSpeed: z.number(),
});

const server = new MCPServer({
  name: "ConformanceTestServer",
  version: "1.0.0",
  description:
    "MCP Conformance Test Server implementing all supported features.",
  websiteUrl: "https://mcp-use.com",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["any"],
    },
  ],
  logging: { level: "debug" },
  ...(process.env.INSPECTOR_CDN_BASE && {
    inspector: {
      assetsUrl: `${process.env.INSPECTOR_CDN_BASE}/inspector.js`,
    },
  }),
});

// =============================================================================
// TOOLS
// =============================================================================

server.tool(
  {
    name: "test_simple_text",
    description: "A simple tool that returns text content",
    inputSchema: z.object({
      message: z.string().optional(),
    }),
  },
  async ({ message = "Hello, World!" }) => ({
    content: [{ type: "text", text: `Echo: ${message}` }],
  })
);

server.tool(
  {
    name: "test_typed_arguments",
    description:
      "Validates argument typing for boolean, array, and object parameters",
    inputSchema: z.object({
      flag: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      config: z
        .object({
          mode: z.string(),
          count: z.number(),
        })
        .optional(),
    }),
  },
  async ({
    flag = false,
    tags = [],
    config = { mode: "default", count: 0 },
  }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          flagType: typeof flag,
          tagsIsArray: Array.isArray(tags),
          configIsObject:
            typeof config === "object" &&
            config !== null &&
            !Array.isArray(config),
          values: { flag, tags, config },
        }),
      },
    ],
  })
);

server.tool(
  {
    name: "test_image_content",
    description: "A tool that returns image content",
  },
  async () => ({
    content: [{ type: "image", data: RED_PIXEL_PNG, mimeType: "image/png" }],
  })
);

server.tool(
  {
    name: "test_audio_content",
    description: "A tool that returns audio content",
  },
  async () => ({
    content: [
      { type: "audio", data: SILENT_WAV_BASE64, mimeType: "audio/wav" },
    ],
  })
);

server.tool(
  {
    name: "test_embedded_resource",
    description: "A tool that returns an embedded resource",
  },
  async () => ({
    content: [
      {
        type: "resource",
        resource: {
          uri: "test://embedded",
          mimeType: "text/plain",
          text: "This is embedded resource content",
        },
      },
    ],
  })
);

server.tool(
  {
    name: "test_multiple_content_types",
    description: "A tool that returns mixed content (text + image + resource)",
  },
  async () => ({
    content: [
      { type: "text", text: "Multiple content types test:" },
      { type: "image", data: RED_PIXEL_PNG, mimeType: "image/png" },
      {
        type: "resource",
        resource: {
          uri: "test://mixed-content-resource",
          mimeType: "application/json",
          text: JSON.stringify({ test: "data", value: 123 }),
        },
      },
    ],
  })
);

server.tool(
  {
    name: "test_tool_with_logging",
    description: "A tool that sends log messages during execution",
  },
  async (_input, ctx) => {
    await ctx.sendLog("info", "Tool execution started");
    await sleep(50);
    await ctx.sendLog("info", "Tool processing data");
    await sleep(50);
    await ctx.sendLog("info", "Tool execution completed");
    return {
      content: [
        { type: "text", text: "Tool execution completed with logging" },
      ],
    };
  }
);

server.tool(
  {
    name: "test_tool_with_progress",
    description: "A tool that reports progress",
    inputSchema: z.object({
      steps: z.number().optional(),
    }),
  },
  async ({ steps = 5 }, ctx) => {
    for (let i = 0; i < steps; i++) {
      await ctx.reportProgress(i + 1, steps, `Step ${i + 1} of ${steps}`);
      await sleep(10);
    }
    return {
      content: [{ type: "text", text: `Completed ${steps} steps` }],
    };
  }
);

server.tool(
  {
    name: "test_sampling",
    description: "A tool that uses client LLM sampling",
    inputSchema: z.object({
      prompt: z.string().optional(),
    }),
  },
  async ({ prompt = "Hello" }, ctx) => {
    const response = inputResponse(ctx.inputResponses, "sample");
    if (response.kind === "missing") {
      return inputRequired({
        inputRequests: {
          sample: inputRequired.createMessage({
            messages: [
              { role: "user", content: { type: "text", text: prompt } },
            ],
            maxTokens: 100,
          }),
        },
      });
    }
    if (response.kind === "sampling") {
      const blocks = Array.isArray(response.result.content)
        ? response.result.content
        : [response.result.content];
      const text = blocks
        .map((block) =>
          block.type === "text" ? block.text : JSON.stringify(block)
        )
        .join("\n");
      return { content: [{ type: "text", text: text || "No response" }] };
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Sampling error: Expected a sampling response, got ${response.kind}`,
        },
      ],
    };
  }
);

server.tool(
  {
    name: "test_elicitation",
    description: "A tool that uses elicitation to get user input",
  },
  async (_input, ctx) => {
    const form = await ctx.elicit(
      "elicitation",
      "Please provide your information",
      z.object({
        name: z.string().default("Anonymous"),
        age: z.number().default(0),
      })
    );
    if (form.status === "required") return form.result;
    if (form.status === "accept") {
      return {
        content: [
          {
            type: "text",
            text: `Received: ${form.data.name}, age ${form.data.age}`,
          },
        ],
      };
    }
    if (form.status === "decline") {
      return { content: [{ type: "text", text: "User declined" }] };
    }
    return { content: [{ type: "text", text: "Operation cancelled" }] };
  }
);

server.tool(
  {
    name: "test_elicitation_sep1034_defaults",
    description:
      "A tool that uses elicitation with default values for all primitive types (SEP-1034)",
  },
  async (_input, ctx) => {
    const form = await ctx.elicit(
      "elicitation-sep1034",
      "Please provide your information",
      z.object({
        name: z.string().default("John Doe"),
        age: z.number().int().default(30),
        score: z.number().default(95.5),
        status: z.enum(["active", "inactive", "pending"]).default("active"),
        verified: z.boolean().default(true),
      })
    );
    if (form.status === "required") return form.result;
    if (form.status === "accept") {
      return {
        content: [
          {
            type: "text",
            text: `Elicitation completed: action=accept, content=${JSON.stringify(form.data)}`,
          },
        ],
      };
    }
    if (form.status === "decline") {
      return {
        content: [
          { type: "text", text: "Elicitation completed: action=decline" },
        ],
      };
    }
    return {
      content: [{ type: "text", text: "Elicitation completed: action=cancel" }],
    };
  }
);

server.tool(
  {
    name: "test_elicitation_sep1330_enums",
    description:
      "A tool that uses elicitation with all 5 enum variants (SEP-1330)",
  },
  async (_input, ctx) => {
    // ponytail: z.enum stand-ins for v1 enumSchema variants; titles/names not preserved
    const form = await ctx.elicit(
      "elicitation-sep1330",
      "Please choose your options",
      z.object({
        untitledSingle: z.enum(["option1", "option2", "option3"]),
        titledSingle: z.enum(["value1", "value2", "value3"]),
        legacyEnum: z.enum(["opt1", "opt2", "opt3"]),
        untitledMulti: z.array(z.enum(["option1", "option2", "option3"])),
        titledMulti: z.array(z.enum(["value1", "value2", "value3"])),
      })
    );
    if (form.status === "required") return form.result;
    if (form.status === "accept") {
      return {
        content: [
          {
            type: "text",
            text: `Elicitation completed: action=accept, content=${JSON.stringify(form.data)}`,
          },
        ],
      };
    }
    if (form.status === "decline") {
      return {
        content: [
          { type: "text", text: "Elicitation completed: action=decline" },
        ],
      };
    }
    return {
      content: [{ type: "text", text: "Elicitation completed: action=cancel" }],
    };
  }
);

server.tool(
  {
    name: "test_error_handling",
    description: "A tool that raises an error for testing error handling",
  },
  async () => ({
    isError: true,
    content: [
      { type: "text", text: "This is an intentional error for testing" },
    ],
  })
);

server.tool(
  {
    name: "test_record_schema",
    description:
      "Tests z.record() schema roundtrip with additionalProperties and descriptions",
    inputSchema: z.object({
      files: z
        .record(z.string(), z.string())
        .describe(
          "REQUIRED. A {path: code} object mapping file paths to source code strings."
        ),
      entryFile: z
        .string()
        .optional()
        .describe('Entry file path (default: "/src/Video.tsx").'),
      title: z.string().optional().describe("Title shown in the video player"),
      durationInFrames: z
        .number()
        .optional()
        .describe("Total duration in frames (default: 150)"),
      fps: z.number().optional().describe("Frames per second (default: 30)"),
      width: z.number().optional().describe("Width in pixels (default: 1920)"),
      height: z
        .number()
        .optional()
        .describe("Height in pixels (default: 1080)"),
    }),
  },
  async (params) => ({
    content: [
      {
        type: "text",
        text: `Received ${Object.keys(params.files ?? {}).length} files`,
      },
    ],
  })
);

// =============================================================================
// RESOURCES
// =============================================================================

server.resource(
  {
    name: "static_text",
    uri: "test://static-text",
    title: "Static Text Resource",
    description: "A static text resource",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: "This is static text content",
      },
    ],
  })
);

server.resource(
  {
    name: "static_binary",
    uri: "test://static-binary",
    title: "Static Binary Resource",
    description: "A static binary resource",
    mimeType: "application/octet-stream",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/octet-stream",
        blob: STATIC_BINARY_BLOB,
      },
    ],
  })
);

server.resourceTemplate(
  {
    name: "template_resource",
    uriTemplate: "test://template/{id}/data",
    title: "Template Resource",
    description: "A templated resource",
    mimeType: "application/json",
  },
  async (uri, params) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          id: params.id,
          templateTest: true,
          data: `Data for ID: ${String(params.id)}`,
        }),
      },
    ],
  })
);

let subscribableResourceValue = "Initial value";

server.resource(
  {
    name: "subscribable_resource",
    uri: "test://subscribable",
    title: "Subscribable Resource",
    description: "A resource that supports subscriptions and can be updated",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: subscribableResourceValue,
      },
    ],
  })
);

server.tool(
  {
    name: "update_subscribable_resource",
    description: "Update the subscribable resource and notify subscribers",
    inputSchema: z.object({
      newValue: z.string().default("Updated value"),
    }),
  },
  async ({ newValue }) => {
    subscribableResourceValue = newValue;
    await server.notifyResourceUpdated("test://subscribable");
    return {
      content: [{ type: "text", text: `Resource updated to: ${newValue}` }],
    };
  }
);

// =============================================================================
// PROMPTS
// =============================================================================

server.prompt(
  {
    name: "test_simple_prompt",
    description: "A simple prompt without arguments",
  },
  async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "This is a simple prompt without any arguments.",
        },
      },
    ],
  })
);

server.prompt(
  {
    name: "test_prompt_with_arguments",
    description: "A prompt that accepts arguments",
    schema: z.object({
      arg1: completable(z.string().optional(), () => ["default1"]),
      arg2: completable(z.string().optional(), () => ["default2"]),
    }),
  },
  async ({ arg1 = "default1", arg2 = "default2" }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Prompt with arguments: arg1='${arg1}', arg2='${arg2}'`,
        },
      },
    ],
  })
);

server.prompt(
  {
    name: "test_prompt_with_embedded_resource",
    description: "A prompt that includes an embedded resource",
    schema: z.object({
      resourceUri: z.string().optional(),
    }),
  },
  async ({ resourceUri = "config://embedded" }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: "Here is the configuration:" },
      },
      {
        role: "user",
        content: {
          type: "resource",
          resource: {
            uri: resourceUri,
            mimeType: "application/json",
            text: JSON.stringify({ setting: "value" }),
          },
        },
      },
    ],
  })
);

server.prompt(
  {
    name: "test_prompt_with_image",
    description: "A prompt that includes an image",
  },
  async () => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: "Here is a test image:" },
      },
      {
        role: "user",
        content: {
          type: "image",
          data: RED_PIXEL_PNG,
          mimeType: "image/png",
        },
      },
    ],
  })
);

// =============================================================================
// LEGACY APPS SDK FALLBACK
// =============================================================================

const appsSdkOnlyCardUri = "ui://widget/apps-sdk-only-card.html";

server.resource(
  {
    name: "apps-sdk-only-card",
    uri: appsSdkOnlyCardUri,
    description: "ChatGPT-only Apps SDK card",
    mimeType: "text/html+skybridge",
    _meta: {
      "openai/widgetDescription":
        "A card that only works in ChatGPT through the legacy Apps SDK",
      "openai/widgetPrefersBorder": true,
    },
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/html+skybridge",
        text: `<!doctype html>
<html>
  <body>
    <article id="card">ChatGPT-only Apps SDK card</article>
    <script>
      const message = window.openai?.toolOutput?.message;
      if (typeof message === "string") document.querySelector("#card").textContent = message;
    </script>
  </body>
</html>`,
      },
    ],
  })
);

server.tool(
  {
    name: "apps-sdk-only-card",
    description:
      "Return a legacy Apps SDK card without advertising MCP Apps UI metadata",
    inputSchema: z.object({
      message: z.string().optional().describe("Optional message to display"),
    }),
    _meta: {
      "openai/outputTemplate": appsSdkOnlyCardUri,
    },
  },
  async ({ message = "This card uses the legacy Apps SDK only." }) => ({
    content: [{ type: "text", text: message }],
    structuredContent: { message },
  })
);

// =============================================================================
// VIEW: get-weather-delayed
// =============================================================================

const weatherData: Record<
  string,
  {
    temperature: number;
    conditions: string;
    humidity: number;
    windSpeed: number;
  }
> = {
  tokyo: {
    temperature: 22,
    conditions: "Partly Cloudy",
    humidity: 65,
    windSpeed: 12,
  },
  london: { temperature: 15, conditions: "Rainy", humidity: 80, windSpeed: 20 },
  "new york": {
    temperature: 18,
    conditions: "Sunny",
    humidity: 55,
    windSpeed: 8,
  },
  paris: { temperature: 17, conditions: "Cloudy", humidity: 70, windSpeed: 15 },
};

export const getWeatherDelayed = server.tool(
  {
    name: "get-weather-delayed",
    description:
      "Get weather with artificial 5-second delay to test view lifecycle (Issue #930)",
    inputSchema: z.object({
      city: z.string().describe("City name"),
      delay: z
        .number()
        .default(5000)
        .describe("Delay in milliseconds (default: 5000)"),
    }),
    outputSchema: weatherOutputSchema,
    view: {
      name: "weather-display",
      description:
        "Interactive weather card showing temperature and conditions",
    },
  },
  async ({ city, delay }) => {
    await sleep(delay);

    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] ?? {
      temperature: 20,
      conditions: "Unknown",
      humidity: 50,
      windSpeed: 10,
    };
    const structuredContent = { city, ...weather };

    return {
      content: [
        {
          type: "text",
          text: `Current weather in ${city}: ${weather.conditions}, ${weather.temperature}°C (fetched after ${delay}ms delay)`,
        },
      ],
      structuredContent,
    };
  }
);

server.tool(
  {
    name: "report-client-capabilities",
    description:
      "Report client capabilities advertised on this connection (MCP Apps / UI extension).",
    inputSchema: z.object({}),
    outputSchema: z.object({ supportsApps: z.boolean() }),
  },
  async (_input, ctx) => {
    const supportsApps = ctx.client.supportsViews();
    return {
      content: [{ type: "text", text: JSON.stringify({ supportsApps }) }],
      structuredContent: { supportsApps },
    };
  }
);

export default server;
