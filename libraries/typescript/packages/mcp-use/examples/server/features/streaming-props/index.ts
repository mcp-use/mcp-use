import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "streaming-props-example",
  version: "1.0.0",
  description:
    "Example MCP server demonstrating tool-generated streaming widget props. " +
    "The server streams partial structuredContent updates during tool execution " +
    "before returning the final widget result.",
});

/**
 * STREAMING TOOL PROPS EXAMPLE
 *
 * This demonstrates the `streamWidgetProps()` / `partialToolOutput` feature.
 *
 * The tool itself progressively streams widget props while it is running.
 * Each update is sent with `ctx.streamWidgetProps(...)`, which reaches the
 * widget as `partialToolOutput` / `isOutputStreaming` in useWidget().
 *
 * The code-preview widget shows:
 * - A streaming indicator while `isOutputStreaming` is true
 * - Live rendering of partially generated code/text
 * - Final rendered state once the tool returns
 *
 * To test in the Inspector:
 * 1. Run `mcp-use dev` in this directory
 * 2. Open the Inspector
 * 3. Call `generate-code` with a language and description
 * 4. The widget renders immediately and shows the code as the tool streams it
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildCodeSnippet(language: string, description: string): string {
  if (language.toLowerCase() === "python") {
    return [
      "from dataclasses import dataclass",
      "",
      "@dataclass",
      "class Task:",
      "    description: str",
      "",
      "def run_task(task: Task) -> str:",
      '    return f"Running: {task.description}"',
      "",
      `task = Task(description=${JSON.stringify(description)})`,
      "print(run_task(task))",
    ].join("\n");
  }

  return [
    "type Task = {",
    "  description: string;",
    "};",
    "",
    "function runTask(task: Task): string {",
    String.raw`  return \`Running: \${task.description}\`;`,
    "}",
    "",
    `const task: Task = { description: ${JSON.stringify(description)} };`,
    "console.log(runTask(task));",
  ].join("\n");
}

// Tool that generates code with a widget preview
server.tool(
  {
    name: "generate-code",
    description:
      "Generate a code snippet for the given description. " +
      "The widget shows a live preview as the tool streams partial output.",
    schema: z.object({
      language: z
        .string()
        .describe("Programming language (e.g. typescript, python, rust)"),
      description: z.string().describe("Description of the code to generate"),
    }),
    widget: {
      name: "code-preview",
      invoking: "Generating code...",
      invoked: "Code generated",
    },
  },
  async ({ language, description }, ctx) => {
    const finalCode = buildCodeSnippet(language, description);
    const lines = finalCode.split("\n");

    for (let i = 0; i < lines.length; i += 1) {
      await ctx.streamWidgetProps({
        language,
        description,
        code: lines.slice(0, i + 1).join("\n"),
        generatedLines: i + 1,
      });
      await sleep(90);
    }

    return widget({
      props: {
        language,
        description,
        code: finalCode,
        generatedLines: lines.length,
      },
      message: `Generated ${language} code: ${description}`,
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

This server demonstrates the partialToolOutput / isOutputStreaming feature.

Tools:
- generate-code: Generate code with live tool-output streaming preview widget
- hello: Simple text tool (for comparison)

How streaming props work:
1. The tool calls ctx.streamWidgetProps({ ...partial props... }) while it runs
2. The host forwards ui/notifications/tool-result-partial to the widget
3. The widget receives these via useWidget()'s partialToolOutput field
4. isOutputStreaming stays true until the final tool result arrives
`);
