<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_black.svg">
    <img alt="mcp use logo" src="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">Create mcp-use App</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/create-mcp-use-app" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/create-mcp-use-app.svg"/></a>
    <a href="https://www.npmjs.com/package/create-mcp-use-app" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/create-mcp-use-app.svg"/></a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use-ts" /></a>
    <a href="https://github.com/mcp-use/mcp-use/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use-ts?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

🚀 **Create mcp-use App** is the fastest way to scaffold a new MCP (Model Context Protocol) application. With just one command, you get a fully configured TypeScript project with hot reload, automatic inspector, and UI widget support - everything you need to build powerful MCP servers.

## 📦 Related Packages

| Package                                                                                  | Description             | Version                                                                                                         |
| ---------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| [mcp-use](https://github.com/mcp-use/mcp-use/tree/main/packages/mcp-use)              | Core MCP framework      | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       |
| [@mcp-use/cli](https://github.com/mcp-use/mcp-use/tree/main/packages/cli)             | Build tool for MCP apps | [![npm](https://img.shields.io/npm/v/@mcp-use/cli.svg)](https://www.npmjs.com/package/@mcp-use/cli)             |
| [@mcp-use/inspector](https://github.com/mcp-use/mcp-use/tree/main/packages/inspector) | Web-based MCP inspector | [![npm](https://img.shields.io/npm/v/@mcp-use/inspector.svg)](https://www.npmjs.com/package/@mcp-use/inspector) |

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
├── src/
│   └── index.ts         # MCP server entry point with example tools
├── resources/           # UI widgets directory
│   └── example-widget.tsx  # Example React widget
└── dist/               # Build output (generated)
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

### Direct Mode

Specify the project name directly:

```bash
npx create-mcp-use-app my-project
```

### With Options

```bash
# Use a specific template
npx create-mcp-use-app my-project --template advanced

# Use a specific package manager
npx create-mcp-use-app my-project --use-npm
npx create-mcp-use-app my-project --use-yarn
npx create-mcp-use-app my-project --use-pnpm

# Skip dependency installation
npx create-mcp-use-app my-project --skip-install
```

---

## 🎨 Available Templates

### Basic Template (Default)

The basic template includes:

- Simple MCP server setup
- Example tool, resource, and prompt
- Basic UI widget example
- Essential configuration files

Perfect for getting started quickly or building simple MCP servers.

### Advanced Template

The advanced template includes everything from basic plus:

- Multiple tools with complex schemas
- OAuth authentication example
- Database integration patterns
- Advanced UI widgets with state management
- Observability setup with Langfuse
- Docker configuration
- CI/CD workflows

Ideal for production applications or complex integrations.

### Minimal Template

The minimal template includes:

- Bare-bones MCP server
- No example tools or widgets
- Essential configuration only

Best for experienced developers who want full control.

---

## 🏗️ What Gets Installed

The scaffolded project includes these dependencies:

### Core Dependencies

- `mcp-use` - The MCP framework
- `@mcp-use/cli` - Build and development tool
- `@mcp-use/inspector` - Web-based debugger

### Development Dependencies

- `typescript` - TypeScript compiler
- `tsx` - TypeScript executor for development
- `@types/node` - Node.js type definitions

### Optional Dependencies (Advanced Template)

- Database drivers (PostgreSQL, SQLite)
- Authentication libraries
- Monitoring tools

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

Open `src/index.ts` to see how to:

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

Edit `resources/example-widget.tsx` or create new widgets:

```tsx
import React from 'react'
import { useMcp } from 'mcp-use/react'

export default function MyWidget() {
  const { callTool } = useMcp()

  const handleClick = async () => {
    const result = await callTool('my_tool', {
      param: 'value',
    })
    console.log(result)
  }

  return (
    <div>
      <button onClick={handleClick}>Call MCP Tool</button>
    </div>
  )
}
```

### 4. Connect to AI

Use the MCP server with any MCP-compatible client:

```typescript
import { MCPClient, MCPAgent } from 'mcp-use'
import { ChatOpenAI } from '@langchain/openai'

const client = new MCPClient({
  url: 'http://localhost:3000/mcp',
})

const agent = new MCPAgent({
  llm: new ChatOpenAI(),
  client,
})

const result = await agent.run('Use my MCP tools')
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
server.tool('search_database', {
  description: 'Search for records in the database',
  parameters: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10),
  }),
  execute: async ({ query, limit }) => {
    // Your tool logic here
    const results = await db.search(query, limit)
    return { results }
  },
})
```

### Creating a Resource

```typescript
server.resource('user_profile', {
  description: 'Current user profile data',
  uri: 'user://profile',
  mimeType: 'application/json',
  fetch: async () => {
    const profile = await getUserProfile()
    return JSON.stringify(profile)
  },
})
```

### Creating a Prompt

```typescript
server.prompt('code_review', {
  description: 'Review code for best practices',
  arguments: [
    { name: 'code', description: 'Code to review', required: true },
    { name: 'language', description: 'Programming language', required: false },
  ],
  render: async ({ code, language }) => {
    return `Please review this ${
      language || ''
    } code for best practices:\n\n${code}`
  },
})
```

---

## 🐛 Troubleshooting

### Common Issues

**Command not found:**

```bash
# Make sure you have Node.js 18+ installed
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

## 🚀 Deployment

### Deploy to Supabase

All templates include a comprehensive guide for deploying to Supabase Edge Functions:

- **Starter Template**: See `DEPLOY_SUPABASE.md` in your project
- **Apps SDK Template**: See `DEPLOY_SUPABASE.md` in your project
- **MCP-UI Template**: See `DEPLOY_SUPABASE.md` in your project

The guide covers:
- Building widgets for production
- Converting Node.js entry point to Supabase format
- Deploying to Supabase Edge Functions
- Testing and troubleshooting

---

## 📚 Learn More

- [mcp-use Documentation](https://github.com/mcp-use/mcp-use)
- [Model Context Protocol Spec](https://modelcontextprotocol.io)
- [Creating MCP Tools](https://github.com/mcp-use/mcp-use/tree/main/packages/mcp-use#-mcp-server-framework)
- [Building UI Widgets](https://github.com/mcp-use/mcp-use/tree/main/packages/cli#-creating-ui-widgets)
- [Using the Inspector](https://github.com/mcp-use/mcp-use/tree/main/packages/inspector)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

---

## 📜 License

MIT © [mcp-use](https://github.com/mcp-use)
