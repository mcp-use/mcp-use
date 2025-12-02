import { createMCPServer } from "mcp-use/server";

// Create an MCP server with icons and website URL (SEP-973)
// The server icon and website URL will be displayed in the Inspector
const server = createMCPServer("icons-example-server", {
  version: "1.0.0",
  description: "An example MCP server demonstrating icons and website URL features (SEP-973)",
  // Server-level icon - displayed in the Inspector's server capabilities modal
  icons: [
    {
      src: "https://mcp-use.com/logo.png",
      mimeType: "image/png",
      sizes: "512x512",
    },
  ],
  // Server website URL - displayed as a clickable link in the Inspector
  websiteUrl: "https://mcp-use.com",
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Tool with custom icon
server.tool({
  name: "weather",
  title: "Weather Tool",
  description: "Get the current weather for a location",
  // Tool-specific icon - displayed next to the tool in the Inspector
  icons: [
    {
      src: "https://mcp-use.com/logo.png",
      mimeType: "image/png",
      sizes: "48x48",
    },
  ],
  inputs: [
    {
      name: "location",
      description: "The city or location to get weather for",
      type: "string",
      required: true,
    },
  ],
  cb: async ({ location }: { location: string }) => {
    return {
      content: [
        {
          type: "text",
          text: `The weather in ${location} is sunny and 72°F.`,
        },
      ],
    };
  },
});

// Resource with custom icon
server.resource({
  name: "documentation",
  uri: "resource://documentation",
  title: "API Documentation",
  description: "Complete API documentation for this server",
  mimeType: "text/markdown",
  // Resource-specific icon - displayed next to the resource in the Inspector
  icons: [
    {
      src: "https://mcp-use.com/logo.png",
      mimeType: "image/png",
      sizes: "32x32",
    },
  ],
  readCallback: async () => {
    return {
      contents: [
        {
          uri: "resource://documentation",
          mimeType: "text/markdown",
          text: `# API Documentation

This is an example MCP server demonstrating icons and website URL features.

## Features
- Server-level icons and website URL
- Tool-level icons
- Resource-level icons
- Prompt-level icons

All icons are displayed in the MCP Inspector.
`,
        },
      ],
    };
  },
});

// Prompt with custom icon
server.prompt({
  name: "code-review",
  title: "Code Review Prompt",
  description: "Generate a code review prompt for a given code snippet",
  // Prompt-specific icon - displayed next to the prompt in the Inspector
  icons: [
    {
      src: "https://mcp-use.com/logo.png",
      mimeType: "image/png",
      sizes: "48x48",
    },
  ],
  args: [
    {
      name: "code",
      description: "The code to review",
      type: "string",
      required: true,
    },
    {
      name: "language",
      description: "The programming language",
      type: "string",
      required: false,
    },
  ],
  cb: async ({ code, language = "TypeScript" }: { code: string; language?: string }) => {
    return {
      messages: [
        {
          role: "user",
          content: `Please review this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``,
        },
      ],
    };
  },
});

// Tool with multiple icon sizes (for different display contexts)
server.tool({
  name: "calculator",
  title: "Calculator Tool",
  description: "Perform basic mathematical calculations",
  // Multiple icon sizes - the Inspector will select the best match
  icons: [
    {
      src: "https://mcp-use.com/logo.png",
      mimeType: "image/png",
      sizes: "16x16 32x32 48x48",
    },
  ],
  inputs: [
    {
      name: "expression",
      description: "Mathematical expression to evaluate (e.g., '2 + 2')",
      type: "string",
      required: true,
    },
  ],
  cb: async ({ expression }: { expression: string }) => {
    try {
      // Simple evaluation (in production, use a proper math parser)
      const result = Function(`"use strict"; return (${expression})`)();
      return {
        content: [
          {
            type: "text",
            text: `${expression} = ${result}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Invalid expression "${expression}"`,
          },
        ],
        isError: true,
      };
    }
  },
});

// Resource with data URI icon (base64 encoded)
server.resource({
  name: "config",
  uri: "resource://config",
  title: "Server Configuration",
  description: "Current server configuration",
  mimeType: "application/json",
  // Data URI icon example (small red dot as base64)
  icons: [
    {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      mimeType: "image/png",
      sizes: "1x1",
    },
  ],
  readCallback: async () => {
    return {
      contents: [
        {
          uri: "resource://config",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              server: "icons-example-server",
              version: "1.0.0",
              features: ["icons", "websiteUrl"],
            },
            null,
            2
          ),
        },
      ],
    };
  },
});

// Start the server (MCP endpoints auto-mounted at /mcp)
await server.listen(PORT);
console.log(`🚀 Icons Example Server running on port ${PORT}`);
console.log(`📊 Inspector available at http://localhost:${PORT}/inspector`);
console.log(`🔧 MCP endpoint at http://localhost:${PORT}/mcp`);
console.log(`\n✨ Features demonstrated:`);
console.log(`   - Server icon and website URL`);
console.log(`   - Tool icons (weather, calculator)`);
console.log(`   - Resource icons (documentation, config)`);
console.log(`   - Prompt icons (code-review)`);
console.log(`   - Multiple icon sizes`);
console.log(`   - Data URI icons`);
