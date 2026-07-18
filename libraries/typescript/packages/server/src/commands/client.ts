import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import type { MCPConnection } from "@mcp-use/client";

import { loadClientPackage } from "./load-client.js";
import {
  confirm,
  GLOBAL_STATE_DIR,
  openBrowser,
  pathExists,
  printResult,
  readJson,
  reportError,
  UsageError,
  wantsJson,
  writePrivateJson,
} from "./shared.js";

interface SavedServer {
  url: string;
  oauth: boolean;
  protocol: "auto" | "2026-07-28" | "2025-11-25";
}

interface SavedServers {
  servers: Record<string, SavedServer>;
}

interface SavedCredentials {
  headers?: Record<string, string>;
}

const CLIENT_DIR = join(GLOBAL_STATE_DIR, "client");
const SERVERS_PATH = join(CLIENT_DIR, "servers.json");

const CLIENT_HELP = `Usage: mcp-use client <command> [options]

Commands:
  connect <name> <url>   Connect and save an HTTP(S) MCP server
  list                   List saved servers
  remove <name>          Remove a saved server
  <name>                 Invoke tools/resources/prompts on a saved server

Connect options:
  -H, --header <"Key: Value">   Static header (repeatable)
  --no-oauth                    Skip OAuth on authorization challenges
  --auth-timeout <ms>           OAuth wait timeout (default: 300000)
  --protocol <auto|2026-07-28|2025-11-25>
  --open                        Open the OAuth URL in a browser without prompting
  --no-open                     Print the OAuth URL only
  --json                        Emit machine-readable output

Saved server commands:
  mcp-use client <name> tools list|describe|call ...
  mcp-use client <name> resources list|read ...
  mcp-use client <name> prompts list|get ...
  mcp-use client <name> auth status|logout

Examples:
  mcp-use client connect linear https://mcp.linear.app/mcp
  mcp-use client linear tools list
  mcp-use client linear tools call search_issues query="open bugs"`;

type BrowserMode = "ask" | "always" | "never";

/** Run the `mcp-use client` command family. */
export async function runClient(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(CLIENT_HELP);
    return 0;
  }
  const json = wantsJson(argv);
  try {
    const first = argv[0];
    if (first === "connect") return await connect(argv.slice(1), json);
    if (first === "list") return await list(argv.slice(1), json);
    if (first === "remove") return await remove(argv.slice(1), json);
    if (first === undefined) {
      throw new UsageError("Usage: mcp-use client <connect|list|remove|name>");
    }
    return await savedServerCommand(first, argv.slice(1), json);
  } catch (error) {
    return reportError(
      error instanceof TypeError ? new UsageError(error.message) : error,
      json
    );
  }
}

async function connect(
  argv: readonly string[],
  json: boolean
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      header: { type: "string", short: "H", multiple: true },
      "no-oauth": { type: "boolean" },
      "auth-timeout": { type: "string" },
      protocol: { type: "string", default: "auto" },
      open: { type: "boolean" },
      "no-open": { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  if (values.open === true && values["no-open"] === true) {
    throw new UsageError("Cannot combine --open and --no-open.");
  }
  if (positionals.length !== 2) {
    throw new UsageError("Usage: mcp-use client connect <name> <url>");
  }
  const [name, rawUrl] = positionals as [string, string];
  validateName(name);
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UsageError("Client URLs must use http or https.");
  }
  const protocol = parseProtocol(values.protocol);
  const timeout = parsePositiveInteger(
    values["auth-timeout"] ?? "300000",
    "--auth-timeout"
  );
  const saved = await readServers();
  if (saved.servers[name] !== undefined) {
    throw new UsageError(`Saved server already exists: ${name}`);
  }
  const credentials = { headers: parseHeaders(values.header ?? []) };
  const definition: SavedServer = {
    url: url.href,
    oauth: values["no-oauth"] !== true,
    protocol,
  };
  const connection = await openConnection(
    name,
    definition,
    credentials,
    timeout,
    resolveBrowserMode({
      open: values.open === true,
      noOpen: values["no-open"] === true,
      json,
    })
  );
  await connection.disconnect();
  saved.servers[name] = definition;
  await writePrivateJson(SERVERS_PATH, saved);
  await writePrivateJson(credentialsPath(name), credentials);
  printResult(
    { name, url: definition.url, protocol },
    json,
    `Connected and saved ${name}.`
  );
  return 0;
}

async function list(argv: readonly string[], json: boolean): Promise<number> {
  parseJsonOnly(argv);
  const saved = await readServers();
  const result = Object.entries(saved.servers).map(([name, server]) => ({
    name,
    ...server,
  }));
  printResult(
    result,
    json,
    result.map((server) => `${server.name}\t${server.url}`).join("\n") ||
      "No saved servers."
  );
  return 0;
}

async function remove(argv: readonly string[], json: boolean): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: { yes: { type: "boolean" }, json: { type: "boolean" } },
  });
  const name = one(positionals, "mcp-use client remove <name>");
  if (
    !(await confirm(`Remove saved server ${name}?`, {
      yes: values.yes === true,
      json,
    }))
  ) {
    return 0;
  }
  const saved = await readServers();
  delete saved.servers[name];
  await writePrivateJson(SERVERS_PATH, saved);
  await rm(credentialsDirectory(name), { recursive: true, force: true });
  printResult({ removed: name }, json, `Removed ${name}.`);
  return 0;
}

async function savedServerCommand(
  name: string,
  argv: readonly string[],
  json: boolean
): Promise<number> {
  const saved = await readServers();
  const definition = saved.servers[name];
  if (definition === undefined) {
    throw new UsageError(
      `Unknown saved server: ${name}. Run \`mcp-use client connect ${name} <url>\`.`
    );
  }
  const family = argv[0];
  const operation = argv[1];
  if (family === "auth") {
    if (operation === "status") {
      parseJsonOnly(argv.slice(2));
      const authenticated = await pathExists(oauthDirectory(name));
      printResult(
        { name, oauth: definition.oauth, authenticated },
        json,
        authenticated ? "Authenticated." : "No saved OAuth session."
      );
      return 0;
    }
    if (operation === "logout") {
      const { values, positionals } = parseArgs({
        args: [...argv.slice(2)],
        allowPositionals: true,
        strict: true,
        options: { yes: { type: "boolean" }, json: { type: "boolean" } },
      });
      if (positionals.length !== 0) {
        throw new UsageError(`Usage: mcp-use client ${name} auth logout`);
      }
      if (
        !(await confirm(`Delete OAuth credentials for ${name}?`, {
          yes: values.yes === true,
          json,
        }))
      ) {
        return 0;
      }
      await rm(oauthDirectory(name), { recursive: true, force: true });
      printResult({ loggedOut: name }, json, `Logged out ${name}.`);
      return 0;
    }
  }

  const credentials = await readJson<SavedCredentials>(
    credentialsPath(name),
    {}
  );
  const connection = await openConnection(
    name,
    definition,
    credentials,
    300_000
  );
  try {
    if (family === "tools") {
      if (operation === "list") {
        parseJsonOnly(argv.slice(2));
        const tools = await connection.listTools();
        printResult(
          tools,
          json,
          tools
            .map((tool) => `${tool.name}\t${tool.description ?? ""}`)
            .join("\n")
        );
        return 0;
      }
      if (operation === "describe") {
        const toolName = one(
          argv.slice(2),
          `mcp-use client ${name} tools describe <tool>`
        );
        const tool = (await connection.listTools()).find(
          (candidate) => candidate.name === toolName
        );
        if (tool === undefined)
          throw new UsageError(`Tool not found: ${toolName}`);
        printResult(tool, json);
        return 0;
      }
      if (operation === "call") {
        return await callTool(connection, name, argv.slice(2), json);
      }
    }
    if (family === "resources") {
      if (operation === "list") {
        parseJsonOnly(argv.slice(2));
        const resources = await connection.listResources();
        printResult(resources, json);
        return 0;
      }
      if (operation === "read") {
        const uri = one(
          argv.slice(2),
          `mcp-use client ${name} resources read <uri>`
        );
        printResult(await connection.readResource(uri), json);
        return 0;
      }
    }
    if (family === "prompts") {
      if (operation === "list") {
        parseJsonOnly(argv.slice(2));
        printResult(await connection.listPrompts(), json);
        return 0;
      }
      if (operation === "get") {
        const prompt = argv[2];
        if (prompt === undefined) {
          throw new UsageError(
            `Usage: mcp-use client ${name} prompts get <prompt> [args]`
          );
        }
        printResult(
          await connection.getPrompt(prompt, parseMcpArguments(argv.slice(3))),
          json
        );
        return 0;
      }
    }
    throw new UsageError(
      `Usage: mcp-use client ${name} <tools|resources|prompts|auth> ...`
    );
  } finally {
    await connection.disconnect();
  }
}

async function callTool(
  connection: MCPConnection,
  serverName: string,
  argv: readonly string[],
  json: boolean
): Promise<number> {
  const tool = argv[0];
  if (tool === undefined) {
    throw new UsageError(
      `Usage: mcp-use client ${serverName} tools call <tool> [args]`
    );
  }
  const { values, positionals } = parseArgs({
    args: [...argv.slice(1)],
    allowPositionals: true,
    strict: true,
    options: {
      timeout: { type: "string", default: "30000" },
      json: { type: "boolean" },
    },
  });
  const timeout = parsePositiveInteger(values.timeout, "--timeout");
  const result = await connection.callTool(
    tool,
    parseMcpArguments(positionals),
    { timeout }
  );
  if (result.isError === true) {
    throw new Error(
      `Tool ${tool} returned an error: ${JSON.stringify(result)}`
    );
  }
  printResult(result, json);
  return 0;
}

async function openConnection(
  name: string,
  definition: SavedServer,
  credentials: SavedCredentials,
  authTimeoutMs: number,
  browserMode: BrowserMode = process.stdin.isTTY ? "ask" : "never"
): Promise<MCPConnection> {
  const { createOAuthProvider, MCPClient } = await loadClientPackage();
  const oauthBase = oauthDirectory(name);
  const authProvider = definition.oauth
    ? await createOAuthProvider(definition.url, {
        baseDir: oauthBase,
        authTimeoutMs,
        storageKeyPrefix: `mcp-use-cli:${name}`,
        openBrowser: async (url: string) => {
          process.stderr.write(`Open this URL to authenticate:\n${url}\n`);
          if (browserMode === "never") return;
          if (browserMode === "ask") {
            const accepted = await confirm("Open in browser?", {
              yes: false,
              json: false,
            });
            if (!accepted) return;
          }
          openBrowser(url);
        },
        // Conditional exports select NodeOAuthOptions at runtime. TypeScript
        // resolves the package's browser-default declaration in this build.
      } as unknown as Parameters<typeof createOAuthProvider>[1])
    : undefined;
  const protocolNegotiation =
    definition.protocol === "auto" ? "auto" : { pin: definition.protocol };
  const client = new MCPClient({
    mcpServers: {
      [name]: {
        url: definition.url,
        ...(credentials.headers !== undefined
          ? { headers: credentials.headers }
          : {}),
        ...(authProvider !== undefined ? { authProvider } : { oauth: false }),
        protocolNegotiation,
      },
    },
  });
  return client.connect(name);
}

/**
 * Open a saved server for another CLI command.
 *
 * @internal
 */
export async function openSavedConnection(
  name: string,
  authTimeoutMs = 300_000
): Promise<MCPConnection> {
  const saved = await readServers();
  const definition = saved.servers[name];
  if (definition === undefined) {
    throw new UsageError(`Unknown saved server: ${name}`);
  }
  const credentials = await readJson<SavedCredentials>(
    credentialsPath(name),
    {}
  );
  return openConnection(name, definition, credentials, authTimeoutMs);
}

/**
 * Open an ad-hoc HTTP MCP connection.
 *
 * @internal
 */
export async function openDirectConnection(
  url: string,
  headers: Record<string, string>
): Promise<MCPConnection> {
  return openConnection(
    "screenshot",
    { url, oauth: false, protocol: "auto" },
    { headers },
    300_000
  );
}

/**
 * Parse the CLI's JSON/key-value MCP argument grammar.
 *
 * @internal
 */
export function parseMcpArguments(
  argv: readonly string[]
): Record<string, unknown> {
  if (argv.length === 0) return {};
  if (argv.length === 1 && argv[0]?.trimStart().startsWith("{")) {
    const value = JSON.parse(argv[0]) as unknown;
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new UsageError("The JSON argument must be an object.");
    }
    return value as Record<string, unknown>;
  }
  const result: Record<string, unknown> = {};
  for (const token of argv) {
    const typed = token.indexOf(":=");
    const plain = token.indexOf("=");
    const separator = typed >= 0 ? typed : plain;
    const width = typed >= 0 ? 2 : 1;
    if (separator <= 0) {
      throw new UsageError(
        `Expected key=value or key:=<json>, received: ${token}`
      );
    }
    const key = token.slice(0, separator).replace(/^--/, "");
    const raw = token.slice(separator + width);
    result[key] = typed >= 0 ? (JSON.parse(raw) as unknown) : raw;
  }
  return result;
}

function resolveBrowserMode(options: {
  open: boolean;
  noOpen: boolean;
  json: boolean;
}): BrowserMode {
  if (options.json || options.noOpen || !process.stdin.isTTY) return "never";
  if (options.open) return "always";
  return "ask";
}

function parseHeaders(values: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf(":");
    if (separator <= 0) throw new UsageError(`Invalid header: ${value}`);
    headers[value.slice(0, separator).trim()] = value
      .slice(separator + 1)
      .trim();
  }
  return headers;
}

function parseProtocol(value: string | undefined): SavedServer["protocol"] {
  if (value !== "auto" && value !== "2026-07-28" && value !== "2025-11-25") {
    throw new UsageError(`Invalid protocol: ${value}`);
  }
  return value;
}

function parsePositiveInteger(value: string | undefined, name: string): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) {
    throw new UsageError(`${name} must be a positive integer.`);
  }
  return result;
}

function validateName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new UsageError(
      "Server names must be 1-64 filesystem-safe letters, numbers, dots, dashes, or underscores."
    );
  }
}

async function readServers(): Promise<SavedServers> {
  return readJson(SERVERS_PATH, { servers: {} });
}

function credentialsDirectory(name: string): string {
  return join(
    CLIENT_DIR,
    "credentials",
    createHash("sha256").update(name).digest("hex")
  );
}

function credentialsPath(name: string): string {
  return join(credentialsDirectory(name), "credentials.json");
}

function oauthDirectory(name: string): string {
  return join(credentialsDirectory(name), "oauth");
}

function parseJsonOnly(argv: readonly string[]): void {
  parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: { json: { type: "boolean" } },
  });
}

function one(positionals: readonly string[], usage: string): string {
  if (positionals.length !== 1) throw new UsageError(`Usage: ${usage}`);
  return positionals[0]!;
}
