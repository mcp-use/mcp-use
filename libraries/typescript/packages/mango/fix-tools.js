const fs = require("fs");
const path = require("path");

const toolsDir = "src/agent/tools";
const files = [
  "connect-mcp.ts",
  "list-primitives.ts",
  "call-tool.ts",
  "edit-file.ts",
];

files.forEach((file) => {
  const filePath = path.join(toolsDir, file);
  let content = fs.readFileSync(filePath, "utf8");

  // Add import at the top
  if (!content.includes("import { createToolDefinition")) {
    content =
      `import { createToolDefinition, type AnthropicTool } from "../tool-types.js";\n` +
      content;
  }

  // Replace tool definition pattern
  content = content.replace(
    /export const (\w+)ToolDefinition = \{\s*name: "([^"]+)",\s*description: "([^"]+)",\s*input_schema: \{\s*type: "object",\s*properties: \{([^}]+)\},\s*required: \[([^\]]+)\],\s*\},\s*\};/gs,
    (match, varName, name, desc, props, req) => {
      return `export const ${varName}ToolDefinition: AnthropicTool = createToolDefinition({\n  name: "${name}",\n  description: "${desc}",\n  properties: {${props}},\n  required: [${req}],\n});`;
    }
  );

  fs.writeFileSync(filePath, content);
  console.log(`Fixed ${file}`);
});
