<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_black.svg">
    <img alt="mcp use logo" src="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">mcp-use CLI</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@mcp-use/cli" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/@mcp-use/cli.svg"/></a>
    <a href="https://www.npmjs.com/package/@mcp-use/cli" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/@mcp-use/cli.svg"/></a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use-ts" /></a>
    <a href="https://github.com/mcp-use/mcp-use/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use-ts?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

🛠️ **mcp-use CLI** is a powerful build and development tool for creating MCP (Model Context Protocol) applications with integrated UI widgets. It enables developers to build MCP servers with custom React components that can be served alongside their MCP tools, providing rich visual interfaces for AI interactions.

## 📦 Related Packages

| Package                                                                                                             | Description             | Version                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| [mcp-use](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use)                       | Core MCP framework      | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       |
| [@mcp-use/inspector](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/inspector)          | Web-based MCP inspector | [![npm](https://img.shields.io/npm/v/@mcp-use/inspector.svg)](https://www.npmjs.com/package/@mcp-use/inspector) |
| [create-mcp-use-app](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/create-mcp-use-app) | Create MCP apps         | [![npm](https://img.shields.io/npm/v/create-mcp-use-app.svg)](https://www.npmjs.com/package/create-mcp-use-app) |

---

## ✨ Key Features

| Feature                  | Description                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ |
| **🚀 Auto Inspector**    | Automatically opens the MCP Inspector in your browser when development server starts |
| **♻️ Hot Reload**        | Development mode with automatic reloading for both server code and UI widgets        |
| **🎨 Widget Builder**    | Compiles React components into standalone HTML pages with all dependencies bundled   |
| **📦 Production Ready**  | Optimized production builds with hashed assets for caching                           |
| **🛠️ TypeScript First**  | Full TypeScript support with watch mode compilation                                  |
| **🖥️ Multi-Environment** | Separate commands for development, build, and production deployment                  |

---

## 🚀 Installation

```bash
# Install globally
npm install -g @mcp-use/cli

# Or use with npx (no installation needed)
npx @mcp-use/cli dev

# Install as a project dependency
npm install --save-dev @mcp-use/cli
```

---

## 📖 Usage

### Development Mode

Start a development server with hot reload, automatic TypeScript compilation, and auto-opening inspector:

```bash
mcp-use dev [options]
```

**What happens in dev mode:**

1. TypeScript files are compiled in watch mode
2. UI widgets are built with hot reload
3. Server runs with auto-restart on changes (via tsx)
4. Inspector automatically opens in your browser at `http://localhost:3000/inspector`
5. MCP endpoint is available at `http://localhost:3000/mcp`

**Options:**

- `-p, --path <path>` - Project directory (default: current directory)
- `--port <port>` - Server port (default: 3000)
- `--no-open` - Don't auto-open inspector in browser

### Production Build

Build your MCP application for production deployment:

```bash
mcp-use build [options]
```

**What happens during build:**

1. TypeScript is compiled to JavaScript
2. All `.tsx` files in `resources/` are bundled as standalone HTML pages
3. Assets are hashed for optimal caching
4. Output is optimized and minified

**Options:**

- `-p, --path <path>` - Project directory (default: current directory)

### Production Server

Start the production server from built files:

```bash
mcp-use start [options]
```

**Options:**

- `-p, --path <path>` - Project directory (default: current directory)
- `--port <port>` - Server port (default: 3000)

### Cloud Deployment

Deploy your MCP server to mcp-use cloud:

```bash
# Login to mcp-use cloud
mcp-use login

# Check authentication status
mcp-use whoami

# Deploy your MCP server
mcp-use deploy [options]

# Logout
mcp-use logout
```

**Deploy Options:**

- `--name <name>` - Custom deployment name
- `--port <port>` - Server port (default: 3000)
- `--runtime <runtime>` - Runtime environment: "node" or "python"
- `--open` - Open deployment in browser after success

**Example:**

```bash
# Basic deployment
mcp-use deploy

# Deploy with custom options
mcp-use deploy --name my-server --port 8000 --open
```

---

## 💡 Examples

### Basic Development Workflow

```bash
# Create a new MCP app (using create-mcp-use-app)
npx create-mcp-use-app my-mcp-server

# Navigate to project
cd my-mcp-server

# Start development with auto-reload and inspector
mcp-use dev

# Browser automatically opens to http://localhost:3000/inspector
```

### Custom Port Configuration

```bash
# Development on port 8080
mcp-use dev --port 8080

# Production on port 8080
mcp-use build
mcp-use start --port 8080
```

### Working with Different Project Structures

```bash
# Specify custom project path
mcp-use dev -p ./my-app
mcp-use build -p ./my-app
mcp-use start -p ./my-app

# Development without auto-opening browser
mcp-use dev --no-open
```

### CI/CD Pipeline Example

```bash
# In your CI/CD pipeline
npm install
npm run build  # Uses mcp-use build
npm run start  # Uses mcp-use start

# Or with PM2 for production
npm run build
pm2 start "mcp-use start" --name my-mcp-server
```

---

## 📁 Project Structure

The CLI expects the following project structure:

```
my-mcp-app/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts         # Your MCP server entry point
├── resources/           # UI widgets (React components)
│   ├── todo-list.tsx    # Becomes /widgets/todo-list/index.html
│   └── dashboard.tsx    # Becomes /widgets/dashboard/index.html
└── dist/               # Build output
    ├── index.js        # Compiled server
    └── resources/
        └── mcp-use/
            └── widgets/
                ├── todo-list/
                │   ├── index.html
                │   └── assets/
                │       └── index-[hash].js
                └── dashboard/
                    ├── index.html
                    └── assets/
                        └── index-[hash].js
```

---

## 🎨 Creating UI Widgets

UI widgets are React components that get compiled into standalone HTML pages. They can interact with your MCP server tools using the `useMcp` hook:

```tsx
// resources/task-manager.tsx
import React, { useState, useEffect } from "react";
import { useMcp } from "mcp-use/react";

export default function TaskManager() {
  const { callTool, status, error } = useMcp();
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState("");

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    const result = await callTool("list_tasks");
    setTasks(result.tasks);
  };

  const addTask = async () => {
    if (!newTask.trim()) return;

    await callTool("create_task", {
      title: newTask,
      status: "pending",
    });

    setNewTask("");
    await loadTasks();
  };

  if (status === "connecting") return <div>Connecting...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Task Manager</h1>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder="Add a new task..."
          className="flex-1 p-2 border rounded"
        />
        <button
          onClick={addTask}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Add Task
        </button>
      </div>

      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="p-2 border rounded">
            {task.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

This widget will be available at `http://localhost:3000/widgets/task-manager` after building.

---

## 🔧 Configuration

### TypeScript Configuration

Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "resources/**/*"]
}
```

### Package.json Scripts

Add these scripts for convenience:

```json
{
  "scripts": {
    "dev": "mcp-use dev",
    "build": "mcp-use build",
    "start": "mcp-use start",
    "serve": "npm run build && npm run start"
  }
}
```

---

## 🚀 Advanced Usage

### Environment Variables

#### Development & Build

```bash
# Custom port via environment variable
PORT=8080 mcp-use dev

# Production build with custom output
BUILD_DIR=./build mcp-use build

# Custom MCP URL for widget asset paths
MCP_URL=https://myserver.com mcp-use build
```

#### Deployment & Cloud

For deploying to mcp-use cloud, see [ENVIRONMENT.md](./ENVIRONMENT.md) for detailed configuration:

```bash
# Frontend URL (where /auth/cli page is)
MCP_WEB_URL=https://mcp-use.com

# Backend API URL (where /api/v1 endpoints are)
MCP_API_URL=https://cloud.mcp-use.com

# Example: Local development
export MCP_WEB_URL=http://localhost:3000
export MCP_API_URL=http://localhost:8000
mcp-use login
mcp-use deploy
```

See [ENVIRONMENT.md](./ENVIRONMENT.md) for more examples and configuration options.

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Integration with Existing Express Apps

If you have an existing Express app, you can mount the built widgets:

```ts
import express from "express";
import path from "path";

const app = express();

// Serve MCP widgets
app.use(
  "/widgets",
  express.static(path.join(__dirname, "../dist/resources/mcp-use/widgets"))
);

// Your other routes...
```

---

## 🐛 Troubleshooting

### Common Issues

**Port already in use:**

```bash
# Use a different port
mcp-use dev --port 3001
```

**TypeScript compilation errors:**

```bash
# Check your tsconfig.json
# Ensure all dependencies are installed
npm install
```

**Widgets not loading:**

- Ensure `.tsx` files are in the `resources/` directory
- Check that React dependencies are installed
- Verify the build output in `dist/resources/mcp-use/widgets/`

**Inspector not opening:**

```bash
# Manually open http://localhost:3000/inspector
# Or disable auto-open
mcp-use dev --no-open
```

---

## 📚 Learn More

- [mcp-use Documentation](https://github.com/mcp-use/mcp-use)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Creating MCP Servers](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use#-mcp-server-framework)
- [MCP Inspector Guide](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/inspector)

---

## 📜 License

MIT © [mcp-use](https://github.com/mcp-use)
