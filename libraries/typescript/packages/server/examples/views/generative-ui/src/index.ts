/**
 * Generative UI — a json-render MCP Apps example.
 *
 * The model writes a structured json-render spec directly into the tool
 * arguments. MCP Apps hosts can stream those arguments to the mounted View,
 * which renders each usable partial snapshot before the final tool result.
 */
import { MCPServer } from "mcp-use";
import { z } from "zod";

import { catalog } from "../views/generative-ui/catalog.js";

const server = new MCPServer({
  name: "generative-ui",
  version: "1.0.0",
  title: "Generative UI",
  legacy: "stateless",
  logging: { level: "debug" },
  description:
    "Render json-render specifications in a live MCP Apps view as the model generates them.",
  basePath: "/mcp",
});

const specSchema = catalog.zodSchema();

function catalogGuidance(): string {
  const prompt = catalog.prompt();
  const dynamicListsStart = prompt.indexOf("DYNAMIC LISTS (repeat field):");
  const componentStart = prompt.indexOf("AVAILABLE COMPONENTS");

  // `catalog.prompt()` starts with JSONL-patch output instructions, which do
  // not apply to an MCP structured tool argument. Keep only the sections that
  // document repeated elements, built-in actions, event bindings, and the
  // available components. State is described here in structured-object terms.
  if (dynamicListsStart === -1 || componentStart === -1) return prompt;
  return `STATE MODEL:\nPut initial values in the top-level \`spec.state\` object. Use JSON Pointer paths (for example \`/todos\` and \`/newTodoText\`) to refer to that state.\n\n${prompt.slice(dynamicListsStart, componentStart)}${prompt.slice(componentStart)}`;
}

const renderUiOutputSchema = z.object({
  spec: specSchema,
  elementCount: z.number(),
});

export const renderUi = server.tool(
  {
    name: "render-ui",
    title: "Render UI",
    description: `Render an interactive UI with the json-render catalog below.

Generate one complete structured object in the \`spec\` argument — do not emit JSONL patches or a stringified JSON document. To make the UI appear as early as possible in MCP Apps clients, write \`spec.root\` and its root element first, then add referenced elements progressively. The final spec must be valid and every child reference must exist.

If the UI claims to support adding, removing, toggling, or editing items, implement that behavior in the spec with state and an \`on\` event binding. For an addable checklist or to-do list, use a repeated element backed by state, bind the input to state, and bind the Add button's \`press\` event to the built-in \`pushState\` action. Never describe an interaction that is not represented in the spec.

${catalogGuidance()}`,
    inputSchema: z.object({
      spec: specSchema.describe(
        "A json-render specification. This structured argument streams into the View while it is generated."
      ),
    }),
    outputSchema: renderUiOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
    view: {
      name: "generative-ui",
      description: "A live json-render generative UI",
      prefersBorder: false,
    },
  },
  async ({ spec }) => {
    const elementCount = Object.keys(spec.elements).length;
    return {
      content: [
        {
          type: "text",
          text: `Rendered ${elementCount} UI ${elementCount === 1 ? "element" : "elements"}.`,
        },
      ],
      structuredContent: { spec, elementCount },
    };
  }
);

export default server;
