// Supabase Edge Function for MCP Server
// This example demonstrates how to deploy an MCP server on Supabase Edge Functions
//
// To deploy this function:
// 1. Install Supabase CLI: https://supabase.com/docs/guides/cli
// 2. Run: supabase functions new mcp-server
// 3. Copy this file to supabase/functions/mcp-server/index.ts
// 4. Set NODE_ENV=production for production widget mode (no dev dependencies needed)
// 5. Deploy: supabase functions deploy mcp-server
//
// For local development with the package:
import { createMCPServer } from "https://esm.sh/mcp-use@1.2.5-dev.4/server";

// Create the MCP server instance
// CORS is enabled by default with origin: "*" to allow all origins
// This allows the MCP server to be accessed from any domain
const server = createMCPServer("supabase-mcp-server", {
  version: "1.0.0",
  description: "MCP server deployed on Supabase Edge Functions",
});

// Define a simple greeting tool
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

// Define a tool that gets the current timestamp
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

// Define a resource that provides server information
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

// Note: NODE_ENV is automatically set to "production" in Supabase Edge Functions
// Widgets will work in production mode (built widgets only, no dev dependencies)

// CORS headers for Supabase Edge Functions
// See: https://supabase.com/docs/guides/functions/cors
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, mcp-protocol-version, mcp-session-id',
};

// Get the fetch handler from the server
// The 'supabase' provider handles path rewriting automatically
const handler = await server.getHandler({ provider: 'supabase' });

// Export the handler for Supabase Edge Functions
// Handle CORS preflight requests (OPTIONS) explicitly for browser access
// Deno is available in Supabase Edge Functions runtime
(globalThis as any).Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Call the handler and ensure CORS headers are included in the response
  const response = await handler(req);
  
  // Add CORS headers to the response
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
});
