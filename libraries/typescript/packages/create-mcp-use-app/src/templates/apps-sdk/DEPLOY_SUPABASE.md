# Deploying to Supabase Edge Functions

This guide walks you through deploying your MCP server with widgets to Supabase Edge Functions after development.

## Prerequisites

1. **Supabase CLI**: Install from [Supabase CLI Installation Guide](https://supabase.com/docs/guides/cli)
2. **Supabase Account**: Create a project at [database.new](https://database.new)
3. **Completed Development**: Your widgets are working locally with `npm run dev`

## Overview

The deployment process involves:
1. Building your widgets for production
2. Converting the Node.js entry point to Supabase Edge Function format
3. Setting up the Supabase function structure
4. Deploying to Supabase

## Step 1: Build Your Project

First, build your widgets and server for production:

```bash
npm run build
```

This creates:
- `dist/index.js` - Your compiled server code
- `dist/resources/widgets/` - Pre-built widget bundles (HTML, JS, CSS)

## Step 2: Initialize Supabase (if not already done)

If you don't have a Supabase project initialized:

```bash
# Initialize Supabase in your project root
supabase init
```

## Step 3: Create the Edge Function

Create a new Supabase Edge Function:

```bash
supabase functions new mcp-server
```

This creates `supabase/functions/mcp-server/` directory.

## Step 4: Convert Your Entry Point

Your current `index.ts` uses `server.listen()` which works for Node.js but not for Supabase Edge Functions. You need to convert it to use `getHandler()`.

### Original Entry Point (Node.js)

```typescript
// index.ts (current)
import { createMCPServer } from "mcp-use/server";

const server = createMCPServer("my-mcp-server", {
  version: "1.0.0",
  description: "My MCP server",
  baseUrl: process.env.MCP_URL,
});

// ... your tools, resources, prompts, widgets ...

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
server.listen(PORT);
```

### Supabase Entry Point

Create `supabase/functions/mcp-server/index.ts`:

```typescript
// supabase/functions/mcp-server/index.ts
import { createMCPServer } from "https://esm.sh/mcp-use@latest/server";

// Create the MCP server instance
const server = createMCPServer("my-mcp-server", {
  version: "1.0.0",
  description: "My MCP server deployed on Supabase",
  // Use your Supabase function URL
  baseUrl: Deno.env.get("MCP_URL") || 
    `https://${Deno.env.get("SUPABASE_PROJECT_REF")}.supabase.co/functions/v1/mcp-server`,
});

// Copy all your tools, resources, prompts, and widget registrations here
// from your original index.ts

// Example: Your tools
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

// Example: Your resources
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

// CORS headers for Supabase Edge Functions
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, mcp-protocol-version, mcp-session-id',
};

// Get the fetch handler from the server
// The 'supabase' provider handles path rewriting automatically
const handler = await server.getHandler({ provider: 'supabase' });

// Export the handler for Supabase Edge Functions
// Handle CORS preflight requests (OPTIONS) explicitly for browser access
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
```

### Key Changes:

1. **Import**: Use ESM URL import for Deno: `https://esm.sh/mcp-use@latest/server`
2. **Environment Variables**: Use `Deno.env.get()` instead of `process.env`
3. **Handler**: Use `server.getHandler({ provider: 'supabase' })` instead of `server.listen()`
4. **CORS**: Add CORS headers for browser access
5. **Deno.serve**: Wrap with `Deno.serve()` for Supabase Edge Functions

## Step 5: Copy Built Widgets

Copy your built widgets to the Supabase function directory:

```bash
# Create the widgets directory in the function
mkdir -p supabase/functions/mcp-server/dist/resources/widgets

# Copy built widgets
cp -r dist/resources/widgets/* supabase/functions/mcp-server/dist/resources/widgets/
```

Or use a script to automate this:

```bash
#!/bin/bash
# deploy-prepare.sh

# Build the project
npm run build

# Create directory structure
mkdir -p supabase/functions/mcp-server/dist/resources/widgets

# Copy widgets
cp -r dist/resources/widgets/* supabase/functions/mcp-server/dist/resources/widgets/

echo "✅ Widgets copied to Supabase function directory"
```

## Step 6: Set Up Import Map (Optional)

You can create an `import_map.json` for cleaner imports:

```json
{
  "imports": {
    "mcp-use/server": "https://esm.sh/mcp-use@latest/server"
  }
}
```

Then use regular imports in your code:

```typescript
import { createMCPServer } from "mcp-use/server";
```

## Step 7: Local Testing

Test your function locally before deploying:

```bash
# Start Supabase services
supabase start

# Serve the function locally
supabase functions serve mcp-server
```

The function will be available at `http://localhost:54321/functions/v1/mcp-server`.

### Test with curl

```bash
# Get your local anon key
supabase status

# Test the MCP endpoint
curl -i --location --request POST 'http://localhost:54321/functions/v1/mcp-server/mcp' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

### Test Widgets

Widgets should be accessible at:
```
http://localhost:54321/functions/v1/mcp-server/mcp-use/widgets/{widget-name}
```

## Step 8: Deploy to Supabase

### 1. Login to Supabase

```bash
supabase login
```

### 2. Link Your Project

```bash
supabase link --project-ref YOUR_PROJECT_ID
```

Find your project ID in the Supabase dashboard or run:

```bash
supabase projects list
```

### 3. Set Environment Variables

Set any environment variables your function needs:

```bash
supabase secrets set MCP_URL=https://YOUR_PROJECT_ID.supabase.co/functions/v1/mcp-server
```

### 4. Deploy the Function

```bash
supabase functions deploy mcp-server
```

If Docker is not available, use API-based deployment:

```bash
supabase functions deploy mcp-server --use-api
```

## Step 9: Verify Deployment

After deployment, test your function:

```bash
curl --request POST 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/mcp-server/mcp' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## Project Structure After Setup

```
your-project/
├── dist/                          # Build output
│   ├── index.js
│   └── resources/
│       └── widgets/               # Built widgets
│           ├── kanban-board/
│           └── display-weather/
├── resources/                     # Source widget files
│   ├── kanban-board.tsx
│   └── display-weather.tsx
├── supabase/
│   ├── functions/
│   │   └── mcp-server/
│   │       ├── index.ts           # Supabase function entry point
│   │       ├── import_map.json    # Optional
│   │       └── dist/
│   │           └── resources/
│   │               └── widgets/   # Copied built widgets
│   └── config.toml
├── index.ts                       # Original Node.js entry point
├── package.json
└── tsconfig.json
```

## Important Notes

### Widget Serving

- Widgets are automatically served from `dist/resources/widgets/` in production mode
- The server detects Deno runtime and uses Deno file system APIs
- Widgets must be built before deployment (`npm run build`)

### Environment Variables

- Use `Deno.env.get()` instead of `process.env` in Supabase functions
- Set secrets with `supabase secrets set KEY=value`
- Access them with `Deno.env.get("KEY")`

### Base URL Configuration

Set the `baseUrl` in your server config to your deployed function URL:

```typescript
const server = createMCPServer("my-mcp-server", {
  baseUrl: `https://${Deno.env.get("SUPABASE_PROJECT_REF")}.supabase.co/functions/v1/mcp-server`,
});
```

Or use an environment variable:

```typescript
baseUrl: Deno.env.get("MCP_URL") || "https://your-project.supabase.co/functions/v1/mcp-server"
```

### CORS Configuration

The example includes CORS headers for browser access. Adjust the `Access-Control-Allow-Origin` header if you need to restrict origins:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yourdomain.com', // Specific origin
  // or
  'Access-Control-Allow-Origin': '*', // All origins (development)
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, mcp-protocol-version, mcp-session-id',
};
```

## Troubleshooting

### Widgets Not Loading

1. **Check widget build**: Ensure `npm run build` completed successfully
2. **Verify widget directory**: Check that `dist/resources/widgets/` exists and contains your widgets
3. **Check file paths**: Ensure widgets are copied to `supabase/functions/mcp-server/dist/resources/widgets/`
4. **Check baseUrl**: Verify `baseUrl` is set correctly in server config

### Import Errors

1. **Use ESM URLs**: Make sure you're using `https://esm.sh/mcp-use@latest/server` for imports
2. **Check import_map.json**: If using import maps, ensure the path is correct
3. **Deno compatibility**: Some Node.js packages may not work in Deno - check compatibility

### Function Not Starting

1. **Check syntax**: Ensure your TypeScript/JavaScript is valid
2. **Check Deno.serve**: Make sure you're using `Deno.serve()` wrapper
3. **Check handler**: Verify `getHandler({ provider: 'supabase' })` is called correctly

### Widget Assets Not Loading

1. **Check asset paths**: Widget HTML may reference assets with relative paths
2. **Verify baseUrl**: The `baseUrl` config affects how widget assets are resolved
3. **Check CORS**: Ensure CORS headers allow loading assets

## Automation Script

Create a deployment script to automate the process:

```bash
#!/bin/bash
# deploy-to-supabase.sh

set -e

echo "🔨 Building project..."
npm run build

echo "📦 Copying widgets to Supabase function..."
mkdir -p supabase/functions/mcp-server/dist/resources/widgets
cp -r dist/resources/widgets/* supabase/functions/mcp-server/dist/resources/widgets/

echo "🚀 Deploying to Supabase..."
supabase functions deploy mcp-server

echo "✅ Deployment complete!"
echo "🌐 Function URL: https://YOUR_PROJECT_ID.supabase.co/functions/v1/mcp-server"
```

Make it executable:

```bash
chmod +x deploy-to-supabase.sh
```

## Next Steps

- Set up CI/CD to automate deployments
- Configure custom domain for your function
- Set up monitoring and logging
- Configure authentication if needed

## Learn More

- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
- [MCP Documentation](https://modelcontextprotocol.io)
- [mcp-use Documentation](https://docs.mcp-use.com)
- [Deno Runtime](https://deno.land)

---

Happy deploying! 🚀

