# Supabase Edge Functions MCP Server Example

This is a complete example of deploying an MCP server on Supabase Edge Functions.

## Quick Deployment

Use the automated deployment script to deploy your MCP server to Supabase:

```bash
./deploy.sh <project-id> [function-name] [bucket-name]
```

### Arguments

- `project-id` (required): Your Supabase project ID
- `function-name` (optional): Name of the edge function (default: `mcp-server`)
- `bucket-name` (optional): Name of the storage bucket (default: `widgets`)

### Example

```bash
# Deploy with defaults
./deploy.sh nnpumlykjksvxivhywwo

# Deploy with custom function and bucket names
./deploy.sh nnpumlykjksvxivhywwo my-mcp-function my-bucket
```

### What the script does

1. Validates Supabase CLI installation and authentication
2. Checks if the project is initialized and linked
3. Patches `config.toml` with your project ID
4. Builds your MCP application with the correct MCP_URL
5. Copies build artifacts to the function directory
6. Deploys the function to Supabase Edge Functions
7. Uploads widgets to the storage bucket

### Prerequisites

- Supabase CLI installed (`npm install -g supabase`)
- Logged in to Supabase (`supabase login`)
- Project initialized (`supabase init` - script will check)

## Documentation

For a complete deployment guide and manual steps, see the [Deploying to Supabase](https://docs.mcp-use.com/typescript/server/deployment/supabase) documentation.
