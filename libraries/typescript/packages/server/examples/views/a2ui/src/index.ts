import { MCPServer } from "mcp-use";
import { z } from "zod";

import { specSchema } from "../views/generative-ui/catalog.js";

const server = new MCPServer({
  name: "a2ui-generative-ui",
  version: "1.0.0",
  title: "A2UI Generative UI",
  description: "Model-generated A2UI layouts rendered inside an MCP App.",
  legacy: "stateless",
});

/** Render the model's A2UI component layout in the attached MCP App. */
export const renderUi = server.tool(
  {
    name: "render-ui",
    title: "Render A2UI",
    description: `Generate and render an interactive UI using A2UI's basic catalog.
Write one structured spec object, not JSONL or a string. You choose the layout and content.
Use Text, Row, Column, Card, Divider, TextField, CheckBox, Slider, and ChoicePicker.
Put component properties directly alongside id and component (no props wrapper).
Start with a Column named root. Refer to children by ID; a Card takes one child.
Use Text variants h2/h3/body/caption for hierarchy and Cards for related groups.
Bind editable controls with value: {path: "/key"} and put initial values in spec.data.
CheckBox values are booleans, Slider values are numbers, TextField values are strings,
and ChoicePicker values are arrays of option strings. Text can also bind to /key,
so a Text and TextField sharing a binding update together.
These controls edit local UI state. Do not invent submit buttons, saving, calculations,
network requests, or actions. This example displays the completed response.
Example: {"components":[{"id":"root","component":"Column","children":["heading","done"]},{"id":"heading","component":"Text","text":"My checklist","variant":"h2"},{"id":"done","component":"CheckBox","label":"Try A2UI","value":{"path":"/done"}}],"data":{"done":false}}`,
    inputSchema: z.object({ spec: specSchema }),
    outputSchema: z.object({ spec: specSchema }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    view: { name: "generative-ui", prefersBorder: false },
  },
  async ({ spec }) => ({
    content: [
      {
        type: "text",
        text: `Rendered ${spec.components.length} A2UI components.`,
      },
    ],
    structuredContent: { spec },
  })
);

export default server;
