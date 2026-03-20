import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "streaming-props-example",
  version: "1.0.0",
  description:
    "Example MCP server demonstrating streaming tool props to widgets. " +
    "When an LLM generates complex tool arguments (code, JSON, etc.), " +
    "the widget receives partial arguments in real-time via `partialToolInput` / `isStreaming`.",
});

/**
 * STREAMING TOOL PROPS EXAMPLE
 *
 * This demonstrates the `partialToolInput` / `isStreaming` feature in useWidget.
 *
 * When a host (like the MCP Inspector or an LLM client) sends
 * `ui/notifications/tool-input-partial` notifications as the LLM streams
 * tool arguments, the widget receives them in real-time and can render
 * a live preview of the incoming data.
 *
 * The code-preview widget shows:
 * - A streaming indicator while `isStreaming` is true
 * - Live rendering of partially received code/text
 * - Final rendered state once complete args arrive
 *
 * To test in the Inspector:
 * 1. Run `mcp-use dev` in this directory
 * 2. Open the Inspector
 * 3. Call `generate-code` with a language and description
 * 4. The widget renders immediately and shows the code as it "streams in"
 */

// Tool that generates code with a widget preview
server.tool(
  {
    name: "generate-code",
    description:
      "Generate a code snippet for the given description. " +
      "The widget shows a live preview of the code as it streams in.",
    schema: z.object({
      language: z
        .string()
        .describe("Programming language (e.g. typescript, python, rust)"),
      description: z.string().describe("Description of the code to generate"),
      code: z.string().describe("The generated code snippet"),
    }),
    widget: {
      name: "code-preview",
      invoking: "Generating code...",
      invoked: "Code generated",
    },
  },
  async ({ language, description, code }) => {
    return widget({
      props: {
        language,
        description,
        code,
      },
      message: `Generated ${language} code: ${description}`,
    });
  }
);

// Tool that generates a JSON document with streaming preview
server.tool(
  {
    name: "generate-json",
    description:
      "Generate a JSON configuration or data structure. " +
      "The widget shows a live preview of the JSON as it streams in.",
    schema: z.object({
      title: z.string().describe("Title of the JSON document"),
      description: z.string().describe("Description of the JSON structure"),
      content: z.string().describe("The JSON content as a string"),
    }),
    widget: {
      name: "code-preview",
      invoking: "Generating JSON...",
      invoked: "JSON generated",
    },
  },
  async ({ title, description, content }) => {
    return widget({
      props: {
        language: "json",
        description: `${title}: ${description}`,
        code: content,
      },
      message: `Generated JSON: ${title}`,
    });
  }
);

// Simple text tool for comparison (no streaming)
server.tool(
  {
    name: "hello",
    description: "A simple greeting tool (no widget, for comparison)",
    schema: z.object({
      name: z.string().describe("Name to greet"),
    }),
  },
  async ({ name }) => text(`Hello, ${name}!`)
);

await server.listen();

console.log(`
Streaming Props Example Server Started!

This server demonstrates the partialToolInput / isStreaming feature.

Tools:
- generate-code: Generate code with live streaming preview widget
- generate-json: Generate JSON with live streaming preview widget
- hello: Simple text tool (for comparison)

How streaming props work:
1. When the LLM starts generating tool arguments, the host sends
   ui/notifications/tool-input-partial with the partial args parsed so far
2. The widget receives these via useWidget()'s partialToolInput field
3. isStreaming is true while partial args are arriving
4. Once the full args arrive (tool-input notification), isStreaming becomes false
   and toolInput contains the complete arguments
`);
