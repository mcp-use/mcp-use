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

🚀 **Create mcp-use App** is the fastest way to scaffold a new MCP (Model Context Protocol) application. With just one command, you get a fully configured TypeScript project with hot reload, automatic inspector, and UI widget support - everything you need to build powerful MCP servers.

## 📦 Related Packages

| Package                                                                                       | Description        | Version                                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| [mcp-use](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use) | MCP SDK framework  | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use) |

---

## ⚡ Quick Start

Create a new MCP application in seconds:

```bash
npx create-mcp-use-app my-mcp-server
cd my-mcp-server
npm run dev
```

That's it! Your MCP server is running at `http://localhost:3000` with the inspector automatically opened in your browser.

---

## 🎯 What It Creates

Running `create-mcp-use-app` sets up a complete MCP development environment:

### Project Structure

```
my-mcp-server/
├── package.json          # Pre-configured with all scripts
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment variables template
├── .gitignore           # Git ignore rules
├── README.md            # Project documentation
├── mcp-use.json         # Root mcp-use project config
├── index.ts             # MCP server entry point with example tools
├── resources/           # UI widgets directory
│   └── example-widget.tsx  # Example React widget
└── .mcp-use/            # Build output and generated files
```

### Pre-configured Features

| Feature                 | Description                                       |
| ----------------------- | ------------------------------------------------- |
| **📝 TypeScript**       | Full TypeScript setup with proper types           |
| **🔥 Hot Reload**       | Auto-restart on code changes during development   |
| **🔍 Auto Inspector**   | Inspector UI opens automatically in dev mode      |
| **🎨 UI Widgets**       | React components that compile to standalone pages |
| **🛠️ Example Tools**    | Sample MCP tools, resources, and prompts          |
| **📦 Build Scripts**    | Ready-to-use development and production scripts   |
| **🚀 Production Ready** | Optimized build configuration                     |

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
npx create-mcp-use-app my-project --template blank

# Use a GitHub repository as a template
npx create-mcp-use-app my-project --template owner/repo
npx create-mcp-use-app my-project --template https://github.com/owner/repo
npx create-mcp-use-app my-project --template owner/repo#branch-name

# Use a specific package manager
npx create-mcp-use-app my-project --npm
npx create-mcp-use-app my-project --yarn
npx create-mcp-use-app my-project --pnpm

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

### Starter Template (Default)

The starter template includes:

- Comprehensive MCP server setup with all features
- Example tool, resource, and prompt
- Example tool, resource, and prompt
- Full TypeScript configuration
- Development and production scripts

Perfect for getting started with all available features or building full-featured MCP servers.

### MCP Apps Template

The mcp-apps template includes:

- MCP server setup focused on MCP Apps-compatible clients
- Direct inline JSX widget returns for simple visual responses
- Advanced file-based widget example with state and tool interactions

Ideal for building MCP servers that render widgets in ChatGPT, Claude, and other MCP Apps-compatible clients.

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

- `mcp-use` - The MCP framework

### Development Dependencies

- `typescript` - TypeScript compiler
- `@types/node` - Node.js type definitions

The `mcp-use` package provides the `mcp-use` command used by `npm run dev`, `npm run build`, and `npm run start`.

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
yarn dev
# or
pnpm dev
```

This will:

1. Start the MCP server on port 3000
2. Open the inspector in your browser
3. Watch for file changes and auto-reload

### Build for Production

```bash
npm run build
```

Creates an optimized build in `.mcp-use/build`.

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

The inspector automatically opens at `http://localhost:3000/inspector` where you can:

- Test your tools interactively
- View available resources
- Debug tool executions
- Monitor server status

### 3. Create a UI Widget

In the `mcp-apps` template, return simple widgets directly from tool handlers:

```tsx
/** @jsxImportSource mcp-use/jsx */
import { text } from "mcp-use/server";
import MyWidget from "./components/MyWidget";

return <MyWidget message="Hello" _output={text("Hello")} />;
```

### 4. Connect to AI

Use the MCP server with any MCP-compatible client:

```typescript
import { MCPClient, MCPAgent } from "mcp-use";
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

# OAuth (if using authentication)
OAUTH_CLIENT_ID=your_client_id
OAUTH_CLIENT_SECRET=your_client_secret

# Database (if using database)
DATABASE_URL=postgresql://localhost/myapp

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
import { object } from "mcp-use/server";
import { z } from "zod";

server.tool(
  {
    name: "search-database",
    description: "Search for records in the database",
    schema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().min(1).max(50).default(10).describe("Max results"),
    }),
  },
  async ({ query, limit }) => {
    const results = await db.search(query, limit);
    return object({ results });
  }
);
```

### Creating a Resource

```typescript
server.resource(
  {
    name: "user-profile",
    description: "Current user profile data",
    uri: "user://profile",
  },
  async () => {
    const profile = await getUserProfile();
    return object(profile);
  }
);
```

### Creating a Prompt

```typescript
import { text } from "mcp-use/server";

server.prompt(
  {
    name: "code-review",
    description: "Review code for best practices",
    schema: z.object({
      code: z.string().describe("Code to review"),
      language: z.string().optional().describe("Programming language"),
    }),
  },
  async ({ code, language }) =>
    text(`Please review this ${language ?? ""} code:\n\n${code}`)
);
```

---

## 🐛 Troubleshooting

### Common Issues

**Command not found:**

```bash
# Make sure you have Node.js 20.19+ installed
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
- [Creating MCP Tools](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use#-mcp-server-framework)
- [Building UI Widgets](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/cli#-creating-ui-widgets)
- [Using the Inspector](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/inspector)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

---

## 📜 License

MIT © [mcp-use](https://github.com/mcp-use)
