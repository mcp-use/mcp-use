#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import open from "open";
import { registerInspectorShell } from "./inspector-shell.js";
import { registerInspectorProxyRoutes } from "./proxy-routes.js";
import { createConfidentialClientResolver } from "./cli-config.js";
import {
  createMemoryOAuthProxyStateStore,
  createRedisOAuthProxyStateStore,
  decodeOAuthProxyEncryptionKey,
} from "./proxy/index.js";
import type { OAuthProxyEncryptionKey } from "./proxy/index.js";
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
const production = process.env.NODE_ENV === "production";
const mcpOriginValue = process.env.INSPECTOR_MCP_ALLOWED_ORIGINS;
const mcpAllowedOrigins =
  mcpOriginValue !== undefined
    ? parseOrigins(mcpOriginValue)
    : process.env.INSPECTOR_OAUTH_ALLOWED_ORIGINS !== undefined
      ? oauthAllowedOrigins
      : production
        ? []
        : undefined;
const redisUrl = process.env.INSPECTOR_OAUTH_REDIS_URL ?? process.env.REDIS_URL;
const encryptionKeyValue = process.env.INSPECTOR_OAUTH_ENCRYPTION_KEY;
const oauthStateStoreMode = parseOAuthStateStoreMode(
  process.env.INSPECTOR_OAUTH_STATE_STORE,
  redisUrl,
  encryptionKeyValue,
  production
);
const oauthProxyStateStore =
  oauthStateStoreMode === "redis"
    ? createRedisOAuthProxyStateStore({
        url: redisUrl!,
        encryptionKey: decodeOAuthProxyEncryptionKey(encryptionKeyValue!),
        encryptionKeyId: process.env.INSPECTOR_OAUTH_ENCRYPTION_KEY_ID,
        decryptionKeys: parsePreviousEncryptionKeys(
          process.env.INSPECTOR_OAUTH_PREVIOUS_ENCRYPTION_KEYS_JSON
        ),
        keyPrefix:
          process.env.INSPECTOR_OAUTH_REDIS_KEY_PREFIX ??
          `mcp-use:inspector:oauth:${process.env.NODE_ENV ?? "development"}:`,
      })
    : oauthStateStoreMode === "memory"
      ? createMemoryOAuthProxyStateStore()
      : undefined;
const oauthProxyConfidentialClientResolver = createConfidentialClientResolver(
  process.env.INSPECTOR_OAUTH_CONFIDENTIAL_CLIENTS_JSON
);

registerInspectorProxyRoutes(app, {
  autoConnectUrl: mcpUrl,
  oauthProxyAllowedOrigins: oauthAllowedOrigins,
  mcpProxyAllowedOrigins: mcpAllowedOrigins,
  oauthProxyAllowLoopback: allowLoopback,
  oauth: oauthStateStoreMode !== "disabled",
  oauthProxyStateStore,
  oauthProxyConfidentialClientResolver,
});

registerInspectorShell(app, {
  inspectorMode: "standalone",
  manufactChatUrl: process.env.MANUFACT_CHAT_URL,
});

let shutdownStarted = false;
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
let activeServer: ReturnType<typeof serve> | undefined;

async function startServer() {
  try {
    await oauthProxyStateStore?.ready?.();
    const port = await findAvailablePort(startPort);
    const server = serve({
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
    activeServer = server;
    return { port, fetch: app.fetch };
  } catch (error) {
    console.error(
      `Failed to start server (StartupError): ${formatErrorDiagnostic(error)}`
    );
    process.exit(1);
  }
}

startServer();

async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  await Promise.race([
    Promise.allSettled([
      closeHttpServer(activeServer),
      oauthProxyStateStore?.close?.(),
    ]).then(() => undefined),
    deadline,
  ]);
  console.log(`MCP Inspector stopped (${signal}).`);
  process.exit(0);
}

function closeHttpServer(
  server: ReturnType<typeof serve> | undefined
): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

type OAuthStateStoreMode = "disabled" | "memory" | "redis";

function parseOAuthStateStoreMode(
  value: string | undefined,
  redisUrl: string | undefined,
  encryptionKey: string | undefined,
  production: boolean
): OAuthStateStoreMode {
  const mode = value?.trim().toLowerCase();
  if (mode && mode !== "disabled" && mode !== "memory" && mode !== "redis") {
    throw new Error(
      "INSPECTOR_OAUTH_STATE_STORE must be one of disabled, memory, or redis"
    );
  }
  const resolved =
    (mode as OAuthStateStoreMode | undefined) ??
    (redisUrl || encryptionKey ? "redis" : production ? "disabled" : "memory");
  if (resolved === "redis" && (!redisUrl || !encryptionKey)) {
    throw new Error(
      "Redis OAuth state mode requires INSPECTOR_OAUTH_REDIS_URL (or REDIS_URL) and INSPECTOR_OAUTH_ENCRYPTION_KEY"
    );
  }
  return resolved;
}

function parsePreviousEncryptionKeys(
  value: string | undefined
): OAuthProxyEncryptionKey[] | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "INSPECTOR_OAUTH_PREVIOUS_ENCRYPTION_KEYS_JSON must be valid JSON"
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "INSPECTOR_OAUTH_PREVIOUS_ENCRYPTION_KEYS_JSON must be an array"
    );
  }
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid previous OAuth encryption key entry");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.key !== "string") {
      throw new Error("Invalid previous OAuth encryption key entry");
    }
    return {
      id: record.id,
      key: decodeOAuthProxyEncryptionKey(record.key),
    };
  });
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
