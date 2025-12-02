/**
 * MCP Conformance Test Server (TypeScript)
 *
 * This server implements all supported MCP features to maximize conformance test pass rate.
 * Uses the exact tool/resource/prompt names expected by the MCP conformance test suite.
 * Run with: pnpm dev or tsx src/server.ts
 */

import { createMCPServer } from "mcp-use/server";
import { z } from "zod";

// Create server instance
const server = createMCPServer("ConformanceTestServer", {
  version: "1.0.0",
  description:
    "MCP Conformance Test Server implementing all supported features.",
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// 1x1 red PNG pixel as base64
const RED_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

// =============================================================================
// TOOLS (exact names expected by conformance tests)
// =============================================================================

// tools-call-simple-text (message is optional)
server.tool({
  name: "test_simple_text",
  description: "A simple tool that returns text content",
  inputs: [
    {
      name: "message",
      type: "string",
      description: "Message to echo",
      required: false,
    },
  ],
  cb: async (params) => ({
    content: [
      { type: "text", text: `Echo: ${params.message || "Hello, World!"}` },
    ],
  }),
});

// tools-call-image
server.tool({
  name: "test_image",
  description: "A tool that returns image content",
  inputs: [],
  cb: async () => ({
    content: [
      {
        type: "image",
        data: RED_PIXEL_PNG,
        mimeType: "image/png",
      },
    ],
  }),
});

// tools-call-embedded-resource
server.tool({
  name: "test_embedded_resource",
  description: "A tool that returns an embedded resource",
  inputs: [],
  cb: async () => ({
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
  }),
});

// tools-call-mixed-content
server.tool({
  name: "test_mixed_content",
  description: "A tool that returns mixed content (text + image)",
  inputs: [],
  cb: async () => ({
    content: [
      { type: "text", text: "Here is some text content" },
      {
        type: "image",
        data: RED_PIXEL_PNG,
        mimeType: "image/png",
      },
    ],
  }),
});

// tools-call-with-progress (steps is optional with default)
server.tool({
  name: "test_tool_with_progress",
  description: "A tool that reports progress",
  inputs: [
    {
      name: "steps",
      type: "number",
      description: "Number of steps to execute",
      required: false,
    },
  ],
  cb: async (params, ctx) => {
    const steps = params.steps || 5;

    for (let i = 0; i < steps; i++) {
      if (ctx.reportProgress) {
        await ctx.reportProgress(i + 1, steps, `Step ${i + 1} of ${steps}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return {
      content: [{ type: "text", text: `Completed ${steps} steps` }],
    };
  },
});

// tools-call-sampling (prompt is optional)
server.tool({
  name: "test_sampling",
  description: "A tool that uses client LLM sampling",
  inputs: [
    {
      name: "prompt",
      type: "string",
      description: "Prompt to send to the LLM",
      required: false,
    },
  ],
  cb: async (params, ctx) => {
    try {
      const result = await ctx.sample({
        messages: [
          {
            role: "user",
            content: { type: "text", text: params.prompt || "Hello" },
          },
        ],
        maxTokens: 100,
      });

      const content = Array.isArray(result.content)
        ? result.content[0]
        : result.content;

      return {
        content: [
          {
            type: "text",
            text: (content as any).text || "No response",
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Sampling error: ${error.message || String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
});

// tools-call-elicitation
server.tool({
  name: "test_elicitation",
  description: "A tool that uses elicitation to get user input",
  inputs: [],
  cb: async (params, ctx) => {
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
        return {
          content: [
            {
              type: "text",
              text: `Received: ${result.data.name}, age ${result.data.age}`,
            },
          ],
        };
      } else if (result.action === "decline") {
        return {
          content: [{ type: "text", text: "User declined" }],
        };
      }
      return {
        content: [{ type: "text", text: "Operation cancelled" }],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Elicitation error: ${error.message || String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
});

// tools-call-elicitation-sep1034-defaults
server.tool({
  name: "test_elicitation_sep1034_defaults",
  description:
    "A tool that uses elicitation with default values for all primitive types (SEP-1034)",
  inputs: [],
  cb: async (params, ctx) => {
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
        return {
          content: [
            {
              type: "text",
              text: `Elicitation completed: action=accept, content=${JSON.stringify(result.data)}`,
            },
          ],
        };
      } else if (result.action === "decline") {
        return {
          content: [
            {
              type: "text",
              text: "Elicitation completed: action=decline",
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: "Elicitation completed: action=cancel",
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Elicitation error: ${error.message || String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
});

// tools-call-error
server.tool({
  name: "test_error_handling",
  description: "A tool that raises an error for testing error handling",
  inputs: [],
  cb: async () => ({
    content: [
      { type: "text", text: "This is an intentional error for testing" },
    ],
    isError: true,
  }),
});

// =============================================================================
// RESOURCES (exact URIs expected by conformance tests)
// =============================================================================

// resources-read-text
server.resource({
  name: "static_text",
  uri: "test://static-text",
  title: "Static Text Resource",
  description: "A static text resource",
  mimeType: "text/plain",
  readCallback: async () => ({
    contents: [
      {
        uri: "test://static-text",
        mimeType: "text/plain",
        text: "This is static text content",
      },
    ],
  }),
});

// resources-read-binary
server.resource({
  name: "static_binary",
  uri: "test://static-binary",
  title: "Static Binary Resource",
  description: "A static binary resource",
  mimeType: "application/octet-stream",
  readCallback: async () => ({
    contents: [
      {
        uri: "test://static-binary",
        mimeType: "application/octet-stream",
        blob: Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]).toString(
          "base64"
        ),
      },
    ],
  }),
});

// resources-templates-read
server.resourceTemplate({
  name: "template_resource",
  resourceTemplate: {
    uriTemplate: "test://template/{id}/data",
    name: "Template Resource",
    description: "A templated resource",
    mimeType: "application/json",
  },
  readCallback: async (uri, params) => ({
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify({
          id: params.id,
          data: `Data for ${params.id}`,
        }),
      },
    ],
  }),
});

// =============================================================================
// PROMPTS (exact names expected by conformance tests)
// All args are optional for conformance tests
// =============================================================================

// prompts-get-simple (no args required)
server.prompt({
  name: "test_simple_prompt",
  description: "A simple prompt without arguments",
  args: [],
  cb: async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "This is a simple prompt without any arguments.",
        },
      },
    ],
  }),
});

// prompts-get-with-args (args optional with defaults)
server.prompt({
  name: "test_prompt_with_arguments",
  description: "A prompt that accepts arguments",
  args: [
    {
      name: "topic",
      type: "string",
      description: "Topic to write about",
      required: false,
    },
    {
      name: "style",
      type: "string",
      description: "Writing style",
      required: false,
    },
  ],
  cb: async (params) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please write about ${params.topic || "general"} in a ${params.style || "formal"} style.`,
        },
      },
    ],
  }),
});

// prompts-get-embedded-resource (resourceUri optional)
server.prompt({
  name: "test_prompt_with_embedded_resource",
  description: "A prompt that includes an embedded resource",
  args: [
    {
      name: "resourceUri",
      type: "string",
      description: "URI of the resource to embed",
      required: false,
    },
  ],
  cb: async (params) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Here is the configuration:",
        },
      },
      {
        role: "user",
        content: {
          type: "resource",
          resource: {
            uri: params.resourceUri || "config://embedded",
            mimeType: "application/json",
            text: '{"setting": "value"}',
          },
        },
      },
    ],
  }),
});

// prompts-get-with-image
server.prompt({
  name: "test_prompt_with_image",
  description: "A prompt that includes an image",
  args: [],
  cb: async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Here is a test image:",
        },
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
  }),
});

// =============================================================================
// START SERVER
// =============================================================================

await server.listen(PORT);
console.log(`🚀 MCP Conformance Test Server running on port ${PORT}`);
console.log(`📊 Inspector available at http://localhost:${PORT}/inspector`);
console.log(`🔧 MCP endpoint at http://localhost:${PORT}/mcp`);
console.log(`
Features implemented:
  Tools: test_simple_text, test_image, test_embedded_resource, test_mixed_content,
         test_tool_with_progress, test_sampling, test_elicitation,
         test_elicitation_sep1034_defaults, test_error_handling
  Resources: test://static-text, test://static-binary, test://template/{id}/data
  Prompts: test_simple_prompt, test_prompt_with_arguments,
           test_prompt_with_embedded_resource, test_prompt_with_image

Missing features (not supported in TypeScript SDK):
  - tools-call-audio (audio content type not implemented)
  - tools-call-with-logging (logging from tools not implemented)
  - resources-subscribe/unsubscribe (subscriptions not implemented)
`);
