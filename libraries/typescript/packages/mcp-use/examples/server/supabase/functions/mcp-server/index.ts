// MCP Server deployed on Supabase Edge Functions
import { createMCPServer } from "https://esm.sh/mcp-use@1.2.5-canary.4/server";

// Note: Cannot use Deno.env.set() in Supabase Edge Functions
// We'll need to set NODE_ENV via the Supabase dashboard or config

// Create the MCP server instance
const PROJECT_REF = Deno.env.get("SUPABASE_PROJECT_REF") || "nnpumlykjksvxivhywwo";
const BASE_URL = Deno.env.get("MCP_URL") || `https://${PROJECT_REF}.supabase.co/functions/v1/mcp-server`;

const server = createMCPServer("test-app", {
  version: "1.0.0",
  description: "Test MCP server with automatic UI widget registration deployed on Supabase",
  baseUrl: BASE_URL,
});

// Register tools from the original index.ts
server.tool({
  name: "get-my-city",
  description: "Get my city",
  cb: async () => {
    return { content: [{ type: "text", text: `My city is San Francisco` }] };
  },
});


// CORS headers for Supabase Edge Functions
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, mcp-protocol-version, mcp-session-id',
};

// Get the fetch handler from the server
// The 'supabase' provider handles path rewriting automatically
const handler = await server.getHandler({ provider: 'supabase' });

// Export the handler for Supabase Edge Functions
Deno.serve(async (req: Request) => {
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
