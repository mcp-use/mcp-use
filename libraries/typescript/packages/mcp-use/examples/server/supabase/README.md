# Supabase Edge Functions MCP Server Example

This example demonstrates how to deploy an MCP (Model Context Protocol) server on Supabase Edge Functions.

## Features

- **Greet Tool**: A simple tool that greets a person by name
- **Get Timestamp Tool**: Returns the current timestamp in ISO format
- **Server Info Resource**: Provides information about the server

## Prerequisites

1. **Supabase CLI**: Install from [Supabase CLI Installation Guide](https://supabase.com/docs/guides/cli)
2. **Supabase Account**: Create a project at [database.new](https://database.new)
3. **Docker** (optional, for local development): Required if you want to test locally

## Setup

### 1. Initialize Supabase Project

If you don't have a Supabase project yet:

```bash
supabase init
```

### 2. Create the Edge Function

```bash
supabase functions new mcp-server
```

This creates a new function at `supabase/functions/mcp-server/`.

### 3. Copy the Example Code

Copy the contents of `index.ts` to `supabase/functions/mcp-server/index.ts`.

### 4. Install Dependencies

Supabase Edge Functions use Deno's import system. You'll need to create an `import_map.json` file in your function directory or use direct imports.

Create `supabase/functions/mcp-server/import_map.json`:

```json
{
  "imports": {
    "mcp-use/server": "https://esm.sh/mcp-use@latest/server"
  }
}
```

Or use direct imports in your code (recommended for Supabase):

```typescript
import { createMCPServer } from "https://esm.sh/mcp-use@latest/server";
```

## Local Development

### Start Supabase Services

```bash
supabase start
```

This starts all Supabase services locally, including the Edge Functions runtime.

### Serve the Function Locally

```bash
supabase functions serve mcp-server
```

The function will be available at `http://localhost:54321/functions/v1/mcp-server`.

### Test the Function

Get your local anon key:

```bash
supabase status
```

Then test with curl (note the required Accept header):

```bash
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

## Deployment

### 1. Login to Supabase

```bash
supabase login
```

### 2. Link Your Project

```bash
supabase link --project-ref YOUR_PROJECT_ID
```

You can find your project ID in the Supabase dashboard or by running:

```bash
supabase projects list
```

### 3. Deploy the Function

```bash
supabase functions deploy mcp-server
```

If Docker is not available, you can use API-based deployment:

```bash
supabase functions deploy mcp-server --use-api
```

### 4. Test the Deployed Function

After deployment, test your function (note the required Accept header):

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

**Expected response:**
```json
{
  "result": {
    "tools": [
      {
        "name": "greet",
        "description": "A tool that greets a person by name",
        ...
      },
      {
        "name": "get-timestamp",
        "description": "Returns the current timestamp in ISO format",
        ...
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

## Using the MCP Server

### From a Client Application

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://YOUR_PROJECT_ID.supabase.co",
  "YOUR_ANON_KEY"
);

// The MCP endpoint is available at /mcp
const mcpUrl = `${supabase.supabaseUrl}/functions/v1/mcp-server/mcp`;
```

### MCP Endpoints

- **POST /mcp**: Main MCP protocol endpoint for message handling
- **GET /mcp**: SSE streaming endpoint for real-time communication
- **DELETE /mcp**: Session cleanup endpoint

## Project Structure

```
supabase/
├── functions/
│   └── mcp-server/
│       ├── index.ts          # Main function code
│       └── import_map.json   # Deno import map (optional)
└── config.toml              # Supabase configuration
```

## Environment Variables

You can set environment variables for your function:

```bash
supabase secrets set MY_SECRET_KEY=my_secret_value
```

Access them in your function:

```typescript
const secret = Deno.env.get("MY_SECRET_KEY");
```

## Troubleshooting

### Function Not Starting Locally

- Make sure Docker is running
- Run `supabase stop` then `supabase start` to restart services
- Check what's running with `supabase status`

### Port Already in Use

- Check what's running with `supabase status`
- Stop other Supabase instances with `supabase stop`

### Import Errors

- Make sure you're using the correct import URL for `mcp-use`
- Check that Deno can access the ESM module
- Consider using an `import_map.json` file

## Learn More

- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
- [MCP Documentation](https://modelcontextprotocol.io)
- [mcp-use Documentation](https://docs.mcp-use.io)

