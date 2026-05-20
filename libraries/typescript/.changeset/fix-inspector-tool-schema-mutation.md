---
"@mcp-use/inspector": patch
---

Fix Inspector chat sending an invalid tool `input_schema` to LLM providers after a tool was opened in the Tools tab. `ToolInputForm` was writing `required: boolean` onto each property of the live tool inputSchema during render; that's not valid JSON Schema (`required` belongs on the parent as a `string[]`), and Anthropic's draft 2020-12 validator rejected it with `tools.0.custom.input_schema invalid`. The render now uses a local `isRequired` and no longer mutates the schema.
