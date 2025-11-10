// Simple test script to verify the MCP server setup
// This can be run with Deno to test the server locally before deploying to Supabase
//
// Run with: deno run --allow-net --allow-env test.ts

import { createMCPServer } from "mcp-use/server";

// Create the MCP server instance (same as in index.ts)
const server = createMCPServer("supabase-mcp-server", {
  version: "1.0.0",
  description: "MCP server deployed on Supabase Edge Functions",
});

// Define the same tools and resources as in index.ts
server.tool({
  name: "greet",
  description: "A tool that greets a person by name",
  inputs: [
    {
      name: "name",
      description: "The name of the person to greet",
      type: "string",
      required: true,
    },
  ],
  cb: async (params: Record<string, any>) => {
    const name = params.name as string;
    return {
      content: [
        {
          type: "text",
          text: `Hello, ${name}! Welcome to the Supabase Edge Function MCP server.`,
        },
      ],
    };
  },
});

server.tool({
  name: "get-timestamp",
  description: "Returns the current timestamp in ISO format",
  inputs: [],
  cb: async () => {
    return {
      content: [
        {
          type: "text",
          text: `Current timestamp: ${new Date().toISOString()}`,
        },
      ],
    };
  },
});

server.resource({
  name: "server-info",
  uri: "resource://server-info",
  title: "Server Information",
  mimeType: "application/json",
  description: "Information about the MCP server running on Supabase",
  annotations: {
    audience: ["user", "assistant"],
    priority: 0.8,
  },
  readCallback: async () => {
    return {
      contents: [
        {
          uri: "resource://server-info",
          mimeType: "application/json",
          text: JSON.stringify({
            name: "supabase-mcp-server",
            version: "1.0.0",
            platform: "Supabase Edge Functions",
            runtime: "Deno",
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    };
  },
});

// Setup server (same as in index.ts)
async function setupServer() {
  const serverInternal = server as any;
  
  if (serverInternal.mountWidgets) {
    await serverInternal.mountWidgets({
      baseRoute: "/mcp-use/widgets",
      resourcesDir: "resources",
    });
  }
  
  if (serverInternal.mountMcp) {
    await serverInternal.mountMcp();
  }
  
  if (serverInternal.mountInspector) {
    await serverInternal.mountInspector();
  }
}

// Test the server
async function test() {
  console.log("Setting up server...");
  await setupServer();
  
  console.log("Server setup complete!");
  console.log("\nTesting MCP endpoint...");
  
  // Test the /mcp endpoint with a tools/list request
  const testRequest = new Request("http://localhost:8000/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  
  const response = await server.fetch(testRequest);
  const data = await response.json();
  
  console.log("Response:", JSON.stringify(data, null, 2));
  
  if (data.result && data.result.tools) {
    console.log(`\n✅ Success! Found ${data.result.tools.length} tools`);
    data.result.tools.forEach((tool: any) => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
  } else {
    console.log("\n❌ Error: Unexpected response format");
  }
}

// Run the test
test().catch(console.error);

