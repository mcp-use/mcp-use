import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import type { MCPConnection } from "@mcp-use/client";

import { resolveClientHelp } from "./client-help.js";
import { loadClientPackage } from "./load-client.js";
import {
  CommandError,
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
  protocol: "auto" | "legacy" | "modern";
}

interface SavedServers {
  servers: Record<string, SavedServer>;
}

interface SavedCredentials {
  headers?: Record<string, string>;
}

const CLIENT_DIR = join(GLOBAL_STATE_DIR, "client");
const SERVERS_PATH = join(CLIENT_DIR, "servers.json");

type BrowserMode = "ask" | "never";

/** Run the `mcp-use client` command family. */
export async function runClient(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    const help = resolveClientHelp(argv);
    if (help.text !== undefined) {
      process.stdout.write(`${help.text}\n`);
      return 0;
    }
    process.stderr.write(`${help.error}\n`);
    return 2;
  }
  const json = wantsJson(argv);
  const normalizedArgv = argv.filter((token) => token !== "--json");
  const first = normalizedArgv[0];
  try {
    if (first === "connect")
      return await connect(normalizedArgv.slice(1), json);
    if (first === "list") return await list(normalizedArgv.slice(1), json);
    if (first === "remove") {
      return await remove(normalizedArgv.slice(1), json);
    }
    if (first === undefined) {
      throw new UsageError("Usage: mcp-use client <connect|list|remove|name>");
    }
    return await savedServerCommand(first, normalizedArgv.slice(1), json);
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
      "no-open": { type: "boolean" },
    },
  });
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
      noOpen: values["no-open"] === true,
      json,
    }),
    json,
    `mcp-use client connect ${name} <url> --no-open`
  );
  const authorization = connection.authorization;
  await connection.disconnect();
  saved.servers[name] = definition;
  await writePrivateJson(SERVERS_PATH, saved);
  await writePrivateJson(credentialsPath(name), credentials);
  printResult(
    {
      name,
      url: safeUrlForOutput(definition.url),
      protocol,
      ...(authorization ? { authorization } : {}),
    },
    json,
    authorization?.mode === "mixed" && !authorization.authenticated
      ? `Connected and saved ${name}.\nThis server is using mixed auth. Public tools are available now; run \`mcp-use client ${name} auth login\` to authenticate.`
      : `Connected and saved ${name}.`
  );
  return 0;
}

async function list(argv: readonly string[], json: boolean): Promise<number> {
  parseJsonOnly(argv);
  const saved = await readServers();
  const result = Object.entries(saved.servers).map(([name, server]) => ({
    name,
    ...server,
    url: safeUrlForOutput(server.url),
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
  const { positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {},
  });
  const name = one(positionals, "mcp-use client remove <name>");
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
        options: { yes: { type: "boolean" } },
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

  validateSavedCommandArgs(name, family, operation, argv.slice(2));
  const credentials = await readJson<SavedCredentials>(
    credentialsPath(name),
    {}
  );
  const connection = await openConnection(
    name,
    definition,
    credentials,
    300_000,
    resolveBrowserMode({ noOpen: false, json }),
    json
  );
  try {
    if (family === "auth" && operation === "login") {
      parseJsonOnly(argv.slice(2));
      await connection.authenticate();
      printResult(
        { name, authenticated: true },
        json,
        `Authenticated ${name}.`
      );
      return 0;
    }
    if (family === "tools") {
      if (operation === "list") {
        parseJsonOnly(argv.slice(2));
        const tools = await connection.listTools();
        printResult(
          tools,
          json,
          tools
            .map((tool) =>
              tool.description
                ? `${tool.name} - ${tool.description}`
                : tool.name
            )
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

function validateSavedCommandArgs(
  name: string,
  family: string | undefined,
  operation: string | undefined,
  args: readonly string[]
): void {
  if (
    (family === "tools" && operation === "list") ||
    (family === "resources" && operation === "list") ||
    (family === "prompts" && operation === "list")
  ) {
    parseJsonOnly(args);
    return;
  }
  if (family === "auth" && operation === "login") {
    parseJsonOnly(args);
    return;
  }
  if (family === "tools" && operation === "describe") {
    one(args, `mcp-use client ${name} tools describe <tool>`);
    return;
  }
  if (family === "tools" && operation === "call") {
    parseToolCallArgs(name, args);
    return;
  }
  if (family === "resources" && operation === "read") {
    one(args, `mcp-use client ${name} resources read <uri>`);
    return;
  }
  if (family === "prompts" && operation === "get") {
    if (args[0] === undefined) {
      throw new UsageError(
        `Usage: mcp-use client ${name} prompts get <prompt> [args]`
      );
    }
    parseMcpArguments(args.slice(1));
    return;
  }
  throw new UsageError(
    `Usage: mcp-use client ${name} <tools|resources|prompts|auth> ...`
  );
}

async function callTool(
  connection: MCPConnection,
  serverName: string,
  argv: readonly string[],
  json: boolean
): Promise<number> {
  const { tool, timeout, positionals } = parseToolCallArgs(serverName, argv);
  const result = await connection.callTool(
    tool,
    parseMcpArguments(positionals),
    { timeout }
  );
  if (result.isError === true) {
    throw new CommandError(
      "tool_error",
      `Tool ${tool} returned an error.`,
      result
    );
  }
  printResult(result, json);
  return 0;
}

function parseToolCallArgs(
  serverName: string,
  argv: readonly string[]
): { tool: string; timeout: number; positionals: string[] } {
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
    },
  });
  const timeout = parsePositiveInteger(values.timeout, "--timeout");
  parseMcpArguments(positionals);
  return { tool, timeout, positionals };
}

async function openConnection(
  name: string,
  definition: SavedServer,
  credentials: SavedCredentials,
  authTimeoutMs: number,
  browserMode: BrowserMode = process.stdin.isTTY ? "ask" : "never",
  quiet = false,
  interactiveCommand = `mcp-use client ${name} tools list`
): Promise<MCPConnection> {
  const { createOAuthProvider, MCPClient, logger } = await loadClientPackage({
    allowInstall: !quiet,
  });
  if (quiet) logger.level = "silent";
  let rejectOAuthInteraction: ((error: CommandError) => void) | undefined;
  const oauthInteractionRequired =
    quiet && definition.oauth
      ? new Promise<never>((_resolve, reject) => {
          rejectOAuthInteraction = reject;
        })
      : undefined;
  const oauthBase = oauthDirectory(name);
  const authProvider = definition.oauth
    ? await createOAuthProvider(definition.url, {
        baseDir: oauthBase,
        authTimeoutMs,
        storageKeyPrefix: `mcp-use-cli:${name}`,
        openBrowser: async (url: string) => {
          if (quiet) {
            const error = new CommandError(
              "oauth_interaction_required",
              "OAuth interaction is required; retry this command without --json in a terminal.",
              {
                server: name,
                nextSteps: [
                  {
                    description: "Authenticate interactively in a terminal",
                    command: interactiveCommand,
                  },
                ],
              }
            );
            rejectOAuthInteraction?.(error);
            throw error;
          }
          if (browserMode === "never") {
            process.stderr.write(`Open this URL to authenticate:\n${url}\n`);
            return;
          }
          await waitForOAuthEnter();
          openBrowser(url);
        },
        // Conditional exports select NodeOAuthOptions at runtime. TypeScript
        // resolves the package's browser-default declaration in this build.
      } as unknown as Parameters<typeof createOAuthProvider>[1])
    : undefined;
  const protocolConfig =
    definition.protocol === "auto"
      ? { protocolNegotiation: "auto" as const }
      : definition.protocol === "modern"
        ? {
            protocolNegotiation: {
              pin: "2026-07-28",
            },
          }
        : {
            protocolNegotiation: "legacy" as const,
            clientOptions: {
              supportedProtocolVersions: ["2025-11-25"],
            },
          };
  const client = new MCPClient({
    mcpServers: {
      [name]: {
        url: definition.url,
        ...(credentials.headers !== undefined
          ? { headers: credentials.headers }
          : {}),
        ...(authProvider !== undefined ? { authProvider } : { oauth: false }),
        ...protocolConfig,
      },
    },
  });
  try {
    const connection = client.connect(name);
    return await (oauthInteractionRequired === undefined
      ? connection
      : Promise.race([connection, oauthInteractionRequired]));
  } catch (error) {
    if (
      error instanceof CommandError &&
      error.code === "oauth_interaction_required"
    ) {
      (authProvider as { dispose?: () => void } | undefined)?.dispose?.();
      await (
        client as typeof client & {
          closeSession?: (serverName: string) => Promise<void>;
        }
      ).closeSession?.(name);
      throw error;
    }
    throw sanitizeConnectionError(
      normalizeProtocolConnectionError(error, definition.protocol),
      definition,
      credentials
    );
  }
}

/**
 * Open a saved server for another CLI command.
 *
 * @internal
 */
export async function openSavedConnection(
  name: string,
  authTimeoutMs = 300_000,
  quiet = false
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
  return openConnection(
    name,
    definition,
    credentials,
    authTimeoutMs,
    process.stdin.isTTY ? "ask" : "never",
    quiet
  );
}

/**
 * Open an ad-hoc HTTP MCP connection.
 *
 * @internal
 */
export async function openDirectConnection(
  url: string,
  headers: Record<string, string>,
  quiet = false
): Promise<MCPConnection> {
  return openConnection(
    "screenshot",
    { url, oauth: false, protocol: "auto" },
    { headers },
    300_000,
    "never",
    quiet
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
  noOpen: boolean;
  json: boolean;
}): BrowserMode {
  if (options.json || options.noOpen || !process.stdin.isTTY) return "never";
  return "ask";
}

async function waitForOAuthEnter(): Promise<void> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    await prompt.question(
      "This server requires OAuth. Press Enter to open your browser."
    );
  } finally {
    prompt.close();
  }
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
  if (value !== "auto" && value !== "legacy" && value !== "modern") {
    throw new UsageError("Invalid protocol. Expected auto, legacy, or modern.");
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

function safeUrlForOutput(raw: string): string {
  const url = new URL(raw);
  if (url.username !== "" || url.password !== "") {
    url.username = "[REDACTED]";
    url.password = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    url.searchParams.set(key, "[REDACTED]");
  }
  if (url.hash !== "") url.hash = "[REDACTED]";
  return url.href;
}

async function readServers(): Promise<SavedServers> {
  const saved = await readJson<{
    servers: Record<
      string,
      Omit<SavedServer, "protocol"> & { protocol?: unknown }
    >;
  }>(SERVERS_PATH, { servers: {} });
  const normalized: SavedServers = { servers: {} };
  let migrated = false;

  for (const [name, server] of Object.entries(saved.servers)) {
    const protocol = normalizeSavedProtocol(server.protocol);
    normalized.servers[name] = { ...server, protocol };
    migrated ||= protocol !== server.protocol;
  }

  if (migrated) {
    await writePrivateJson(SERVERS_PATH, normalized);
  }
  return normalized;
}

function normalizeSavedProtocol(value: unknown): SavedServer["protocol"] {
  if (value === "auto" || value === "legacy" || value === "modern") {
    return value;
  }
  if (value === undefined) return "auto";
  if (value === "2025-11-25") return "legacy";
  if (value === "2026-07-28") return "modern";
  throw new UsageError(
    "Saved server has an invalid protocol setting. Remove and reconnect it."
  );
}

function normalizeProtocolConnectionError(
  error: unknown,
  protocol: SavedServer["protocol"]
): unknown {
  if (
    protocol === "auto" ||
    !(error instanceof Error) ||
    (!error.message.includes("Unsupported protocol version") &&
      !error.message.includes("pinned protocol version"))
  ) {
    return error;
  }
  if (protocol === "legacy") {
    return new CommandError(
      "protocol_mismatch",
      "Server does not support the requested legacy protocol."
    );
  }
  return new CommandError(
    "protocol_mismatch",
    "Server does not support the requested modern protocol (stateless/sessionless, no fallback)."
  );
}

function sanitizeConnectionError(
  error: unknown,
  definition: SavedServer,
  credentials: SavedCredentials
): unknown {
  const secrets = connectionSecrets(definition.url, credentials.headers);
  if (!(error instanceof Error) || secrets.size === 0) return error;
  const message = redactText(error.message, secrets);
  if (error instanceof CommandError) {
    return new CommandError(
      error.code,
      message,
      redactUnknown(error.details, secrets)
    );
  }
  const safe = new Error(message);
  safe.name = error.name;
  return safe;
}

function connectionSecrets(
  rawUrl: string,
  headers: Record<string, string> | undefined
): Set<string> {
  const secrets = new Set<string>();
  const url = new URL(rawUrl);
  for (const value of [
    url.username,
    url.password,
    ...url.searchParams.values(),
    url.hash.slice(1),
  ]) {
    if (value !== "") secrets.add(value);
  }
  for (const value of Object.values(headers ?? {})) {
    if (value !== "") {
      secrets.add(value);
      const bearer = value.match(/^Bearer\s+(.+)$/i)?.[1];
      if (bearer !== undefined) secrets.add(bearer);
    }
  }
  return secrets;
}

function redactUnknown(value: unknown, secrets: ReadonlySet<string>): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, secrets));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactUnknown(item, secrets),
    ])
  );
}

function redactText(value: string, secrets: ReadonlySet<string>): string {
  let result = value;
  for (const secret of secrets) {
    result = result.replaceAll(secret, "[REDACTED]");
  }
  return result;
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
    options: {},
  });
}

function one(positionals: readonly string[], usage: string): string {
  if (positionals.length !== 1) throw new UsageError(`Usage: ${usage}`);
  return positionals[0]!;
}
