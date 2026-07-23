#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import open from "open";
import { registerInspectorShell } from "./inspector-shell.js";
import { registerInspectorProxyRoutes } from "./proxy-routes.js";
import { findAvailablePort, isValidUrl } from "./utils.js";
import { getInspectorVersion } from "./version.js";

const args = process.argv.slice(2);
let mcpUrl: string | undefined;
let startPort = 8080;
let noOpen = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url") {
    if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
      console.error("Error: --url requires a value");
      process.exit(1);
    }
    const url = args[i + 1];
    if (!isValidUrl(url)) {
      console.error("Error: Invalid URL format.");
      console.error("URL must start with http://, https://, ws://, or wss://");
      process.exit(1);
    }
    mcpUrl = url;
    i++;
  } else if (args[i] === "--port") {
    if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
      console.error("Error: --port requires a value");
      process.exit(1);
    }
    const parsedPort = Number.parseInt(args[i + 1], 10);
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      console.error("Error: Port must be a number between 1 and 65535.");
      process.exit(1);
    }
    startPort = parsedPort;
    i++;
  } else if (args[i] === "--no-open") {
    noOpen = true;
  } else if (args[i] === "--version" || args[i] === "-v") {
    console.log(getInspectorVersion());
    process.exit(0);
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
MCP Inspector - Inspect and debug MCP servers

Usage:
  npx @mcp-use/inspector [options]

Options:
  --url <url>    MCP server URL to auto-connect to (e.g., http://localhost:3000/mcp)
  --port <port>  Starting port to try (default: 8080, will find next available)
  --no-open      Do not auto-open inspector in browser
  --version, -v  Show the inspector version
  --help, -h     Show this help message

Examples:
  npx @mcp-use/inspector --url http://localhost:3000/mcp
  npx @mcp-use/inspector --url http://localhost:3000/mcp --port 9000
  npx @mcp-use/inspector
`);
    process.exit(0);
  } else {
    console.error("Error: Unknown option.");
    console.error("Run with --help to see available options.");
    process.exit(1);
  }
}

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    exposeHeaders: ["*"],
  })
);
registerInspectorProxyRoutes(app, {
  autoConnectUrl: mcpUrl,
  oauthProxyAllowedOrigins: [],
  oauthProxyAllowLoopback: true,
});

registerInspectorShell(app, {
  inspectorMode: "standalone",
  manufactChatUrl: process.env.MANUFACT_CHAT_URL,
});

async function startServer() {
  try {
    const port = await findAvailablePort(startPort);
    serve({
      fetch: app.fetch,
      port,
    });
    console.log(`MCP Inspector started at http://localhost:${port}/inspector`);
    if (mcpUrl) {
      console.log("Auto-connect configured.");
    }
    if (!noOpen) {
      const openUrl = new URL(`http://localhost:${port}/inspector`);
      if (mcpUrl) {
        openUrl.searchParams.set("autoConnect", mcpUrl);
      }
      try {
        await open(openUrl.toString());
        console.log("Browser opened.");
      } catch (error) {
        console.log(
          `Browser could not be opened automatically. Open ${openUrl.toString()} manually.`
        );
        console.error(error);
      }
    }
    return { port, fetch: app.fetch };
  } catch (error) {
    console.error("Failed to start server (StartupError).", error);
    process.exit(1);
  }
}

startServer();
