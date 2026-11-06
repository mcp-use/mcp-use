import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

declare const __MCP_USE_CLI_VERSION__: string;
declare const __MCP_USE_POSTHOG_HOST__: string;
declare const __MCP_USE_POSTHOG_KEY__: string;

// Only these literals may leave the process. Never capture raw argv: even a
// positional command segment can be a server name, URL, token, or tool input.
const COMMANDS: Record<string, readonly string[]> = {
  dev: [],
  build: [],
  start: [],
  typecheck: [],
  deploy: [],
  link: [],
  unlink: [],
  login: [],
  logout: [],
  whoami: [],
  screenshot: [],
  skills: ["install"],
  logs: [],
  org: ["list", "current", "use", "create", "update", "members", "invites"],
  servers: ["list", "get", "update", "rm"],
  deployments: ["list", "get", "restart", "promote", "stop", "rm"],
  env: ["list", "set", "rm", "push"],
  domains: ["get", "set-subdomain", "add", "verify", "rm"],
  github: ["connect", "installations", "repos"],
  alerts: ["list", "get", "create", "update", "rm", "options"],
  checklist: ["run", "list", "get", "cancel"],
  client: ["connect", "list", "remove"],
};
const CLIENT_OPERATIONS: Record<string, readonly string[]> = {
  tools: ["list", "describe", "call"],
  resources: ["list", "read"],
  prompts: ["list", "get"],
  auth: ["status", "login", "logout"],
};

function commandProperties(argv: readonly string[]) {
  const help =
    argv[0] === "help" || argv.some((arg) => arg === "--help" || arg === "-h");
  let args = argv[0] === "help" ? argv.slice(1) : argv;
  if (args[1] === "--") args = [args[0]!, ...args.slice(2)];
  // The client accepts --json anywhere, including before the saved name.
  if (args[0] === "client") args = args.filter((arg) => arg !== "--json");
  const root = args[0];
  const command =
    root !== undefined && Object.hasOwn(COMMANDS, root)
      ? root
      : help || args.length === 0
        ? "help"
        : args.length === 1 && (root === "--version" || root === "-v")
          ? "version"
          : "unknown";
  let subcommand: string | undefined;
  if (command === "client" && !COMMANDS.client!.includes(args[1] ?? "")) {
    // `client <saved-server-name> tools call <tool>`: skip the saved name.
    const family = args[2];
    const operation = args[3];
    if (
      family !== undefined &&
      Object.hasOwn(CLIENT_OPERATIONS, family) &&
      operation !== undefined &&
      CLIENT_OPERATIONS[family]!.includes(operation)
    ) {
      subcommand = `${family} ${operation}`;
    }
  } else {
    const operation =
      command === "skills" && args[1] === "add"
        ? "install"
        : args[1] === "remove" && command !== "client"
          ? "rm"
          : args[1];
    if (operation !== undefined && COMMANDS[command]?.includes(operation)) {
      subcommand = operation;
    }
    if (
      command === "org" &&
      operation === "invites" &&
      ["list", "send", "cancel"].includes(args[2] ?? "")
    ) {
      subcommand = `invites ${args[2]}`;
    }
  }
  return {
    command,
    ...(subcommand !== undefined && { subcommand }),
    is_help: help,
  };
}

/** A random installation ID, independent of accounts, projects and credentials. */
function installationId(): string | undefined {
  const directory = join(homedir(), ".mcp-use");
  const file = join(directory, "cli-telemetry.json");
  const read = (): string | undefined => {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("installationId" in value)
    )
      return undefined;
    return typeof value.installationId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.installationId
      )
      ? value.installationId
      : undefined;
  };
  try {
    return read();
  } catch {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      writeFileSync(file, JSON.stringify({ installationId: id }) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      return id;
    } catch {
      // Another CLI may have created the identity concurrently. If storage is
      // unavailable, skip capture instead of inflating adoption with fresh IDs.
      try {
        return read();
      } catch {
        return undefined;
      }
    }
  }
}

/** Record one invocation without delaying command execution or surfacing errors. */
export async function captureCliUsage(argv: readonly string[]): Promise<void> {
  if (
    process.env.MCP_USE_ANONYMIZED_TELEMETRY === "false" ||
    process.env.DO_NOT_TRACK === "1" ||
    process.env.NODE_ENV === "test"
  )
    return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = installationId();
    if (id === undefined) return;
    const controller = new AbortController();
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve();
      }, 500);
    });
    await Promise.race([
      fetch(`${__MCP_USE_POSTHOG_HOST__}/i/v0/e/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          api_key: __MCP_USE_POSTHOG_KEY__,
          event: "mcp_use_cli_command",
          distinct_id: `cli:${id}`,
          timestamp: new Date().toISOString(),
          properties: {
            ...commandProperties(argv),
            cli_version: __MCP_USE_CLI_VERSION__,
            platform: process.platform,
            arch: process.arch,
            node_version: process.versions.node,
            is_ci: Boolean(
              process.env.CI &&
              !["false", "0"].includes(process.env.CI.toLowerCase())
            ),
            is_interactive: Boolean(process.stdin.isTTY),
            $process_person_profile: false,
            $geoip_disable: true,
          },
        }),
      }).then(() => undefined),
      timeout,
    ]);
  } catch {
    // Offline, read-only home, or capture failures must never affect a command.
  } finally {
    clearTimeout(timer);
  }
}
