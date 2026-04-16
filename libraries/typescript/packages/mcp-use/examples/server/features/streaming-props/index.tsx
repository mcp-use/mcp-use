/** @jsxImportSource mcp-use/jsx */

import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";
import CodePreview from "./components/CodePreview";

const server = new MCPServer({
  name: "streaming-props-example",
  version: "1.0.0",
  description:
    "Example MCP server demonstrating streaming tool props to widgets. " +
    "When an LLM generates complex tool arguments (code, JSON, etc.), " +
    "the widget receives partial arguments in real-time via partialToolInput / isStreaming.",
});

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
  },
  async ({ language, description, code }) => {
    return (
      <CodePreview
        language={language}
        description={description}
        code={code}
        _output={text(`Generated ${language} code: ${description}`)}
        _invoking="Generating code..."
        _invoked="Code generated"
        _prefersBorder={true}
        _meta={{ autoResize: true }}
      />
    );
  }
);

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
  },
  async ({ title, description, content }) => {
    return (
      <CodePreview
        language="json"
        description={`${title}: ${description}`}
        code={content}
        _output={text(`Generated JSON: ${title}`)}
        _invoking="Generating JSON..."
        _invoked="JSON generated"
        _prefersBorder={true}
        _meta={{ autoResize: true }}
      />
    );
  }
);

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
Streaming Props Example (inline JSX + components/CodePreview.tsx)
Tools: generate-code, generate-json, hello
`);
