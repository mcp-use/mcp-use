/**
 * MCP Conformance Test Server (TypeScript)
 *
 * This server implements all supported MCP features to maximize conformance test pass rate.
 * Uses the exact tool/resource/prompt names expected by the MCP conformance test suite.
 * Run with: pnpm dev or tsx src/server.ts
 */

import { setTimeout as sleep } from "timers/promises";

import {
  audio,
  binary,
  completable,
  error,
  image,
  MCPServer,
  mix,
  object,
  resource,
  text,
  widget,
} from "mcp-use/server";
import { z } from "zod";

// Create server instance
const server = new MCPServer({
  name: "ConformanceTestServer",
  version: "1.0.0",
  description:
    "MCP Conformance Test Server implementing all supported features.",
});

// 1x1 red PNG pixel as base64
const RED_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

// Minimal valid WAV file: 44-byte header + 1 sample (0x80 = silence for 8-bit PCM)
// Format: 8kHz, mono, 8-bit PCM
const SILENT_WAV_BASE64 =
  "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAABAAgAZGF0YQIAAACA";

// =============================================================================
// TOOLS (exact names expected by conformance tests)
// =============================================================================

// tools-call-simple-text (message is optional)
server.tool(
  {
    name: "test_simple_text",
    description: "A simple tool that returns text content",
    schema: z.object({
      message: z.string().optional(),
    }),
  },
  async ({ message = "Hello, World!" }: { message?: string }) =>
    text(`Echo: ${message}`)
);

// tools-call-image
server.tool(
  {
    name: "test_image_content",
    description: "A tool that returns image content",
  },
  async () => image(RED_PIXEL_PNG, "image/png")
);

// tools-call-audio
server.tool(
  {
    name: "test_audio_content",
    description: "A tool that returns audio content",
  },
  async () => audio(SILENT_WAV_BASE64, "audio/wav")
);

// tools-call-embedded-resource
server.tool(
  {
    name: "test_embedded_resource",
    description: "A tool that returns an embedded resource",
  },
  async () =>
    resource("test://embedded", text("This is embedded resource content"))
);

// tools-call-mixed-content
server.tool(
  {
    name: "test_multiple_content_types",
    description: "A tool that returns mixed content (text + image + resource)",
  },
  async () =>
    mix(
      text("Multiple content types test:"),
      image(RED_PIXEL_PNG, "image/png"),
      resource(
        "test://mixed-content-resource",
        object({ test: "data", value: 123 })
      )
    )
);

// tools-call-with-logging
server.tool(
  {
    name: "test_tool_with_logging",
    description: "A tool that sends log messages during execution",
  },
  async (params, ctx) => {
    // Send 3 log notifications as required by conformance test
    await ctx.log("info", "Tool execution started");
    await sleep(50);

    await ctx.log("info", "Tool processing data");
    await sleep(50);

    await ctx.log("info", "Tool execution completed");

    return text("Tool execution completed with logging");
  }
);

// tools-call-with-progress (steps is optional with default)
server.tool(
  {
    name: "test_tool_with_progress",
    description: "A tool that reports progress",
    schema: z.object({
      steps: z.number().optional(),
    }),
  },
  async ({ steps = 5 }, ctx) => {
    for (let i = 0; i < steps; i++) {
      if (ctx.reportProgress) {
        await ctx.reportProgress(i + 1, steps, `Step ${i + 1} of ${steps}`);
      }
      await sleep(10);
    }

    return text(`Completed ${steps} steps`);
  }
);

// tools-call-sampling (prompt is optional)
server.tool(
  {
    name: "test_sampling",
    description: "A tool that uses client LLM sampling",
    schema: z.object({
      prompt: z.string().optional(),
    }),
  },
  async ({ prompt = "Hello" }, ctx) => {
    try {
      const result = await ctx.sample(prompt);
      return text((result.content as { text?: string })?.text || "No response");
    } catch (err: any) {
      return error(`Sampling error: ${err.message || String(err)}`);
    }
  }
);

// tools-call-elicitation
server.tool(
  {
    name: "test_elicitation",
    description: "A tool that uses elicitation to get user input",
  },
  async (params, ctx) => {
    try {
      // Use the simplified elicitation API with Zod schema
      const result = await ctx.elicit(
        "Please provide your information",
        z.object({
          name: z.string().default("Anonymous"),
          age: z.number().default(0),
        })
      );

      // Handle the three possible actions
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

// tools-call-elicitation-sep1034-defaults
server.tool(
  {
    name: "test_elicitation_sep1034_defaults",
    description:
      "A tool that uses elicitation with default values for all primitive types (SEP-1034)",
  },
  async (params, ctx) => {
    try {
      const result = await ctx.elicit(
        "Please provide your information",
        z.object({
          name: z.string().default("John Doe"),
          age: z.number().int().default(30),
          score: z.number().default(95.5),
          status: z.enum(["active", "inactive", "pending"]).default("active"),
          verified: z.boolean().default(true),
        })
      );

      if (result.action === "accept") {
        return text(
          `Elicitation completed: action=accept, content=${JSON.stringify(result.data)}`
        );
      } else if (result.action === "decline") {
        return text("Elicitation completed: action=decline");
      }
      return text("Elicitation completed: action=cancel");
    } catch (err: any) {
      return error(`Elicitation error: ${err.message || String(err)}`);
    }
  }
);

// tools-call-error
server.tool(
  {
    name: "test_error_handling",
    description: "A tool that raises an error for testing error handling",
  },
  async () => error("This is an intentional error for testing")
);

// =============================================================================
// RESOURCES (exact URIs expected by conformance tests)
// =============================================================================

// resources-read-text
server.resource(
  {
    name: "static_text",
    uri: "test://static-text",
    title: "Static Text Resource",
    description: "A static text resource",
  },
  async () => text("This is static text content")
);

// resources-read-binary
server.resource(
  {
    name: "static_binary",
    uri: "test://static-binary",
    title: "Static Binary Resource",
    description: "A static binary resource",
  },
  async () =>
    binary(
      Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]).toString(
        "base64"
      ),
      "application/octet-stream"
    )
);

// resources-templates-read
server.resourceTemplate(
  {
    name: "template_resource",
    resourceTemplate: {
      uriTemplate: "test://template/{id}/data",
      name: "Template Resource",
      description: "A templated resource",
      mimeType: "application/json",
      callbacks: {
        complete: {
          id: ["foo", "bar", "baz", "qux"],
        },
      },
    },
  },
  async (uri: URL, variables: Record<string, any>) => ({
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify({
          id: variables.id,
          templateTest: true,
          data: `Data for ID: ${variables.id}`,
        }),
      },
    ],
  })
);

// resources-subscribe / resources-unsubscribe
// Add a dynamic resource that can be subscribed to and updated
let subscribableResourceValue = "Initial value";

server.resource(
  {
    name: "subscribable_resource",
    uri: "test://subscribable",
    title: "Subscribable Resource",
    description: "A resource that supports subscriptions and can be updated",
  },
  async () => text(subscribableResourceValue)
);

// Tool to trigger resource update for subscription testing
server.tool(
  {
    name: "update_subscribable_resource",
    description: "Update the subscribable resource and notify subscribers",
    schema: z.object({
      newValue: z.string().default("Updated value"),
    }),
  },
  async ({ newValue }) => {
    subscribableResourceValue = newValue;
    // Notify all subscribers of the update
    await server.notifyResourceUpdated("test://subscribable");
    return text(`Resource updated to: ${newValue}`);
  }
);

// =============================================================================
// PROMPTS (exact names expected by conformance tests)
// All args are optional for conformance tests
// =============================================================================

// prompts-get-simple (no args required)
server.prompt(
  {
    name: "test_simple_prompt",
    description: "A simple prompt without arguments",
  },
  async () => text("This is a simple prompt without any arguments.")
);

// prompts-get-with-args (args optional with defaults)
server.prompt(
  {
    name: "test_prompt_with_arguments",
    description: "A prompt that accepts arguments",
    schema: z.object({
      arg1: completable(z.string(), ["foo", "bar"]),
      arg2: completable(z.string(), ["baz", "qux"]),
    }),
  },
  async ({ arg1, arg2 }) =>
    text(`Prompt with arguments: arg1='${arg1}', arg2='${arg2}'`)
);

// prompts-get-embedded-resource (resourceUri optional)
server.prompt(
  {
    name: "test_prompt_with_embedded_resource",
    description: "A prompt that includes an embedded resource",
    schema: z.object({
      resourceUri: z.string().optional(),
    }),
  },
  async ({ resourceUri = "config://embedded" }) =>
    mix(
      text("Here is the configuration:"),
      resource(resourceUri, object({ setting: "value" }))
    )
);

// prompts-get-with-image
server.prompt(
  {
    name: "test_prompt_with_image",
    description: "A prompt that includes an image",
  },
  async (params) =>
    mix(text("Here is a test image:"), image(RED_PIXEL_PNG, "image/png"))
);

// =============================================================================
// UI WIDGET: get-weather-delayed (weather display with artificial delay)
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

server.tool(
  {
    name: "get-weather-delayed",
    description:
      "Get weather with artificial 5-second delay to test widget lifecycle (Issue #930)",
    schema: z.object({
      city: z.string().describe("City name"),
      delay: z
        .number()
        .default(5000)
        .describe("Delay in milliseconds (default: 5000)"),
    }),
    widget: {
      name: "weather-display",
      invoking: "Fetching weather data...",
      invoked: "Weather data loaded",
    },
  },
  async ({ city, delay }) => {
    await sleep(delay);

    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] || {
      temperature: 20,
      conditions: "Unknown",
      humidity: 50,
      windSpeed: 10,
    };

    return widget({
      props: {
        city,
        ...weather,
      },
      message: `Current weather in ${city}: ${weather.conditions}, ${weather.temperature}°C (fetched after ${delay}ms delay)`,
    });
  }
);

await server.listen();
