<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_black.svg">
    <img alt="mcp use logo" src="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">Create mcp-use App</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/create-mcp-use-app" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/create-mcp-use-app.svg"/></a>
    <a href="https://www.npmjs.com/package/create-mcp-use-app" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/create-mcp-use-app.svg"/></a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use" /></a>
    <a href="https://github.com/mcp-use/mcp-use/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

🚀 **Create mcp-use App** scaffolds a TypeScript MCP project with hot reload, the inspector, and MCP Apps view support.

## 📦 Related Packages

| Package                                                                                                    | Description             | Version                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| [mcp-use](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/server)               | MCP framework and CLI   | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       |
| [@mcp-use/inspector](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/inspector) | Web-based MCP inspector | [![npm](https://img.shields.io/npm/v/@mcp-use/inspector.svg)](https://www.npmjs.com/package/@mcp-use/inspector) |

---

## ⚡ Quick Start

Create a new MCP application in seconds:

```bash
npx create-mcp-use-app my-mcp-server
cd my-mcp-server
```

That's it! Your MCP server is running at `http://localhost:3000` with the inspector automatically opened in your browser.

---

## 🎯 What It Creates

The `mcp-apps` template creates this MCP development environment:

### Project Structure

```
my-mcp-server/
├── index.ts                              # MCP server entry point
├── package.json                          # Scripts and dependencies
├── tsconfig.json                         # TypeScript configuration
├── mcp-env.d.ts                          # Managed view typing bridge
├── public/                               # Static assets
└── views/                                # Included by the mcp-apps template
    └── product-search-result/
        └── view.tsx                      # React view entry point
```

### Pre-configured Features

| Feature                 | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| **📝 TypeScript**       | Full TypeScript setup with proper types              |
| **🔥 Hot Reload**       | Auto-restart on code changes during development      |
| **🔍 Auto Inspector**   | Inspector UI opens automatically in dev mode         |
| **🎨 MCP Apps Views**   | React views discovered and bundled by the CLI        |
| **🛠️ Example Tools**    | Sample MCP tools, resources, and prompts             |
| **📦 Build Scripts**    | Ready-to-use development and production scripts      |
| **✅ Type Checking**    | Refreshes MCP view types, then runs local TypeScript |
| **🚀 Production Ready** | Optimized build configuration                        |

---

## 📖 Usage Options

### Interactive Mode

Run without any arguments to enter interactive mode:

```bash
npx create-mcp-use-app
```

You'll be prompted for:

- Project name
- Project template
- Package manager preference
- Install dependencies (Y/n)
- Skills installation (Claude Code, Cursor, Both, or None)

### Direct Mode

Specify the project name directly:

```bash
npx create-mcp-use-app my-project
```

### With Options

```bash
# Use a specific template
npx create-mcp-use-app my-project --template mcp-apps
npx create-mcp-use-app my-project --template mcp-ui

# Use a GitHub repository as a template
npx create-mcp-use-app my-project --template owner/repo
npx create-mcp-use-app my-project --template https://github.com/owner/repo
npx create-mcp-use-app my-project --template owner/repo#branch-name

# Use a specific package manager
npx create-mcp-use-app my-project --npm
npx create-mcp-use-app my-project --pnpm
npx create-mcp-use-app my-project --bun

# Install deps automatically (or --no-install to skip and skip prompt)
npx create-mcp-use-app my-project --install
npx create-mcp-use-app my-project --no-install

# Skills presets for Claude Code / Cursor (omit to prompt)
npx create-mcp-use-app my-project --skills
npx create-mcp-use-app my-project --no-skills

# List all available templates
npx create-mcp-use-app --list-templates
```

---

## 🎨 Available Templates

### MCP Server Template

The `mcp-server` template includes:

- MCP server setup with TypeScript configuration
- Example tool (`fetch-weather`) with structured output
- Example prompt (`review-code`)
- Development and production scripts

Ideal for building MCP servers with tools and prompts (no widgets or resources).

### MCP Apps Template

The mcp-apps template includes:

- MCP server setup focused on OpenAI Apps SDK integration
- OpenAI Apps SDK compatible views under `views/<name>/view.tsx`
- Example `my-view` view with mesh gradient card and interactive demo hooks
- Optimized for OpenAI assistant integration

Ideal for building MCP servers that integrate with OpenAI's Apps SDK.

### MCP-UI Template

The mcp-ui template includes:

- MCP server setup focused on MCP-UI resources
- Interactive UI components example
- Kanban board widget demonstration
- Clean, focused setup for UI-first applications

Best for building MCP servers with rich interactive UI components.

### GitHub Repository Templates

You can use any GitHub repository as a template by providing the repository URL:

```bash
# Short format (owner/repo)
npx create-mcp-use-app my-project --template owner/repo

# Full URL format
npx create-mcp-use-app my-project --template https://github.com/owner/repo

# With specific branch
npx create-mcp-use-app my-project --template owner/repo#branch-name
npx create-mcp-use-app my-project --template https://github.com/owner/repo#branch-name
```

The repository will be cloned and its contents will be used to initialize your project. This is useful for:

- Using community templates
- Sharing custom templates within your organization
- Creating projects from existing repositories

**Note:** Git must be installed and available in your PATH to use GitHub repository templates.

---

## 🏗️ What Gets Installed

The scaffolded project includes these dependencies:

### Core Dependencies

- `mcp-use` - The MCP framework, including its CLI and built-in Inspector

### Development Dependencies

- `typescript` - TypeScript compiler
- `@types/node` - Node.js type definitions

### Template-Specific Dependencies

Different templates may include additional dependencies based on their features:

- UI libraries (React, styling frameworks)
- Widget-specific utilities

---

## 🚀 After Installation

Once your project is created, you can:

### Start Development

```bash
npm run dev
# or
pnpm dev
# or
bun run dev
```

This will:

1. Start the MCP server on port 3000
2. Open the inspector in your browser
3. Watch for file changes and auto-reload

### Build for Production

```bash
npm run build
```

Creates an optimized build in the `dist/` directory.

### Start Production Server

```bash
npm run start
```

Runs the production build.

---

## 💡 First Steps

After creating your app, here's what to do next:

### 1. Explore the Example Server

Open `index.ts` to see how to:

- Define MCP tools with Zod schemas
- Create resources for data access
- Set up prompts for AI interactions

### 2. Try the Inspector

The inspector automatically opens at `http://localhost:3000/mcp/inspector` where you can:

- Test your tools interactively
- View available resources
- Debug tool executions
- Monitor server status

### 3. Create an MCP Apps view

Bind a tool to a view with the tool definition's `view` field:

```typescript
export const showAnalytics = server.tool(
  {
    name: "show-analytics",
    description: "Show analytics for a reporting period",
    inputSchema: z.object({ period: z.string() }),
    outputSchema: z.object({ period: z.string(), visitors: z.number() }),
    view: { name: "analytics-dashboard" },
  },
  async ({ period }) => {
    const analytics = { period, visitors: 1_024 };
    return {
      content: [{ type: "text", text: JSON.stringify(analytics) }],
      structuredContent: analytics,
    };
  }
);
```

Create the component at `views/analytics-dashboard/view.tsx`. Read the bound
tool result with `useToolContext`; call a server tool with `useCallTool`:

```tsx
import { useCallTool, useToolContext } from "mcp-use/react";

interface Analytics {
  period: string;
  visitors: number;
}

export default function AnalyticsDashboard() {
  const view = useToolContext();
  const refresh = useCallTool("show-analytics");

  if (view.status === "pending") return <p>Loading analytics…</p>;
  if (view.status === "error") return <p>{view.error.message}</p>;

  const analytics =
    refresh.data?.structuredContent ?? (view.toolOutput as Analytics);

  return (
    <main>
      <h1>{analytics.visitors} visitors</h1>
      <button
        disabled={refresh.isPending}
        onClick={() => void refresh.callTool({ period: analytics.period })}
      >
        Refresh
      </button>
    </main>
  );
}
```

### 4. Connect to AI

Use the MCP server with any MCP-compatible client:

```typescript
import { MCPClient } from "@mcp-use/client";
import { MCPAgent } from "@mcp-use/agent/langchain";
import { ChatOpenAI } from "@langchain/openai";

const client = new MCPClient({
  url: "http://localhost:3000/mcp",
});

const agent = new MCPAgent({
  llm: new ChatOpenAI(),
  client,
});

const result = await agent.run("Use my MCP tools");
```

---

## 🔧 Configuration

### Environment Variables

The created project includes a `.env.example` file:

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Observability (optional)
LANGFUSE_PUBLIC_KEY=your_public_key
LANGFUSE_SECRET_KEY=your_secret_key
```

Copy to `.env` and configure as needed:

```bash
cp .env.example .env
```

### TypeScript Configuration

The `tsconfig.json` is pre-configured for MCP development:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

---

## 📚 Examples

### Creating a Tool

```typescript
server.tool("search_database", {
  description: "Search for records in the database",
  parameters: z.object({
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(10),
  }),
  execute: async ({ query, limit }) => {
    // Your tool logic here
    const results = await db.search(query, limit);
    return { results };
  },
});
```

### Creating a Resource

```typescript
server.resource("user_profile", {
  description: "Current user profile data",
  uri: "user://profile",
  mimeType: "application/json",
  fetch: async () => {
    const profile = await getUserProfile();
    return JSON.stringify(profile);
  },
});
```

### Creating a Prompt

```typescript
server.prompt("code_review", {
  description: "Review code for best practices",
  arguments: [
    { name: "code", description: "Code to review", required: true },
    { name: "language", description: "Programming language", required: false },
  ],
  render: async ({ code, language }) => {
    return `Please review this ${
      language || ""
    } code for best practices:\n\n${code}`;
  },
});
```

---

## 🐛 Troubleshooting

### Common Issues

**Command not found:**

```bash
# Make sure you have Node.js 22.22.2+ installed
node --version

# Try with npx
npx create-mcp-use-app@latest
```

**Permission denied:**

```bash
# On macOS/Linux, you might need sudo
sudo npx create-mcp-use-app my-app
```

**Network issues:**

```bash
# Use a different registry
npm config set registry https://registry.npmjs.org/
```

**Port already in use:**

```bash
# Change the port in your .env file
PORT=3001
```

---

## 🤝 Contributing

We welcome contributions! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

See our [contributing guide](https://github.com/mcp-use/mcp-use/blob/main/CONTRIBUTING.md) for more details.

---

## 📚 Learn More

- [mcp-use Documentation](https://github.com/mcp-use/mcp-use)
- [Model Context Protocol Spec](https://modelcontextprotocol.io)
- [Creating MCP Tools](https://mcp-use.com/docs/typescript/server/tools)
- [Building MCP App Views](https://mcp-use.com/docs/typescript/mcp-apps)
- [Using the Inspector](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/inspector)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

---

## 📜 License

MIT © [mcp-use](https://github.com/mcp-use)
