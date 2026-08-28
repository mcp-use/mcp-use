#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import open from "open";
import { registerInspectorShell } from "./inspector-shell.js";
import { registerInspectorProxyRoutes } from "./proxy-routes.js";
import {
  createMemoryOAuthProxyStateStore,
  createRedisOAuthProxyStateStore,
  decodeOAuthProxyEncryptionKey,
} from "./proxy/index.js";
import type { OAuthProxyConfidentialClientResolver } from "./proxy/oauth-proxy.js";
import {
  findAvailablePort,
  formatErrorDiagnostic,
  isValidUrl,
} from "./utils.js";
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
// The CLI is primarily local dev tooling, where proxying to localhost MCP
// servers is the main use case — but the published Docker image runs this same
// CLI with NODE_ENV=production on a public port, where loopback proxying is
// SSRF into the container's own services. Allow loopback outside production;
// INSPECTOR_ALLOW_LOOPBACK overrides either way.
const allowLoopback = process.env.INSPECTOR_ALLOW_LOOPBACK
  ? process.env.INSPECTOR_ALLOW_LOOPBACK === "true"
  : process.env.NODE_ENV !== "production";

const oauthAllowedOrigins = parseOrigins(
  process.env.INSPECTOR_OAUTH_ALLOWED_ORIGINS
);
const mcpAllowedOrigins = parseOrigins(
  process.env.INSPECTOR_MCP_ALLOWED_ORIGINS ??
    process.env.INSPECTOR_OAUTH_ALLOWED_ORIGINS
);
const production = process.env.NODE_ENV === "production";
const redisUrl = process.env.INSPECTOR_OAUTH_REDIS_URL ?? process.env.REDIS_URL;
const encryptionKeyValue = process.env.INSPECTOR_OAUTH_ENCRYPTION_KEY;
if (production && (!redisUrl || !encryptionKeyValue)) {
  throw new Error(
    "Production Inspector OAuth requires INSPECTOR_OAUTH_REDIS_URL (or REDIS_URL) and INSPECTOR_OAUTH_ENCRYPTION_KEY"
  );
}
if (production && oauthAllowedOrigins.length === 0) {
  throw new Error(
    "Production Inspector OAuth requires INSPECTOR_OAUTH_ALLOWED_ORIGINS"
  );
}
const oauthProxyStateStore = redisUrl
  ? createRedisOAuthProxyStateStore({
      url: redisUrl,
      encryptionKey: decodeOAuthProxyEncryptionKey(encryptionKeyValue ?? ""),
    })
  : createMemoryOAuthProxyStateStore();
const oauthProxyConfidentialClientResolver = createConfidentialClientResolver(
  process.env.INSPECTOR_OAUTH_CONFIDENTIAL_CLIENTS_JSON
);

registerInspectorProxyRoutes(app, {
  autoConnectUrl: mcpUrl,
  oauthProxyAllowedOrigins: oauthAllowedOrigins,
  mcpProxyAllowedOrigins: mcpAllowedOrigins,
  oauthProxyAllowLoopback: allowLoopback,
  oauthProxyStateStore,
  oauthProxyConfidentialClientResolver,
});

registerInspectorShell(app, {
  inspectorMode: "standalone",
  manufactChatUrl: process.env.MANUFACT_CHAT_URL,
});

process.once("SIGTERM", () => {
  void oauthProxyStateStore.close?.();
});
process.once("SIGINT", () => {
  void oauthProxyStateStore.close?.();
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
        console.error(`Browser open error: ${formatErrorDiagnostic(error)}`);
      }
    }
    return { port, fetch: app.fetch };
  } catch (error) {
    console.error(
      `Failed to start server (StartupError): ${formatErrorDiagnostic(error)}`
    );
    process.exit(1);
  }
}

startServer();

function parseOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function createConfidentialClientResolver(
  value: string | undefined
): OAuthProxyConfidentialClientResolver | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "INSPECTOR_OAUTH_CONFIDENTIAL_CLIENTS_JSON must be valid JSON"
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "INSPECTOR_OAUTH_CONFIDENTIAL_CLIENTS_JSON must be an array"
    );
  }
  const clients = parsed.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid Inspector confidential client entry");
    }
    const record = entry as Record<string, unknown>;
    const serverUrls = Array.isArray(record.serverUrls)
      ? record.serverUrls.filter(
          (url): url is string => typeof url === "string"
        )
      : [];
    const clientId = record.clientId;
    const clientSecret = record.clientSecret;
    const authMethod = record.authMethod;
    if (
      serverUrls.length === 0 ||
      typeof clientId !== "string" ||
      typeof clientSecret !== "string" ||
      (authMethod !== "client_secret_basic" &&
        authMethod !== "client_secret_post")
    ) {
      throw new Error("Invalid Inspector confidential client entry");
    }
    return {
      serverUrls: serverUrls.map((url) => canonicalUrl(url)),
      clientId,
      clientSecret,
      authMethod: authMethod as "client_secret_basic" | "client_secret_post",
    };
  });
  return ({ serverUrl, clientId }) => {
    const match = clients.find(
      (client) =>
        client.clientId === clientId &&
        client.serverUrls.some((url) => url === canonicalUrl(serverUrl))
    );
    return match
      ? {
          clientSecret: match.clientSecret,
          authMethod: match.authMethod,
        }
      : undefined;
  };
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  return url.toString().replace(/\/$/, "");
}
