// Example Supabase Edge Function entry point
// Copy this to supabase/functions/mcp-server/index.ts and adapt it to your needs
//
// This file shows how to convert your Node.js entry point (index.ts) 
// to work with Supabase Edge Functions (Deno runtime)

import { createMCPServer } from "https://esm.sh/mcp-use@latest/server";

// Create the MCP server instance
// Note: baseUrl should point to your deployed Supabase function URL
const server = createMCPServer("my-mcp-server", {
  version: "1.0.0",
  description: "My MCP server deployed on Supabase",
  baseUrl: Deno.env.get("MCP_URL") || 
    `https://${Deno.env.get("SUPABASE_PROJECT_REF")}.supabase.co/functions/v1/mcp-server`,
});

// ============================================
// COPY YOUR TOOLS, RESOURCES, PROMPTS HERE
// ============================================
// Copy all your server.tool(), server.resource(), server.prompt(), 
// and server.uiResource() calls from your original index.ts

// Example tool
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

// Example resource
server.resource({
  name: "config",
  uri: "config://settings",
  mimeType: "application/json",
  description: "Server configuration",
  readCallback: async () => ({
    contents: [
      {
        uri: "config://settings",
        mimeType: "application/json",
        text: JSON.stringify({
          theme: "dark",
          language: "en",
        }),
      },
    ],
  }),
});

// Note: Widgets in resources/ folder are automatically registered
// They will be served from dist/resources/widgets/ in production mode
// NODE_ENV is automatically set to "production" in Supabase Edge Functions

// ============================================
// SUPABASE-SPECIFIC SETUP
// ============================================

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

