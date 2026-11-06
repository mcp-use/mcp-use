import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./bin/args.js";

import { posthogEndpoint, posthogEvent } from "./posthog.js";

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
  feedback: ["send"],
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
  // Feedback text after -- can itself be --help; it is still a submission.
  const messageSeparator =
    argv[0] === "feedback" ? argv.indexOf("--", argv[1] === "--" ? 2 : 1) : -1;
  const optionArgs =
    messageSeparator < 0 ? argv : argv.slice(0, messageSeparator);
  const help =
    argv.length === 0 ||
    argv[0] === "help" ||
    optionArgs.some((arg) => arg === "--help" || arg === "-h");
  let args = argv[0] === "help" ? argv.slice(1) : argv;
  if (args[1] === "--") args = [args[0]!, ...args.slice(2)];
  // The client accepts --json anywhere, including before the saved name.
  if (args[0] === "client") args = args.filter((arg) => arg !== "--json");
  const root = args[0];
  let command =
    root !== undefined && Object.hasOwn(COMMANDS, root)
      ? root
      : help || args.length === 0
        ? "help"
        : args.length === 1 && (root === "--version" || root === "-v")
          ? "version"
          : "unknown";
  // Only local/global requests reach this parser in main(). Cloud and client
  // commands have their own flag grammar; typecheck forwards flags after --.
  if (
    !help &&
    ["dev", "build", "start", "typecheck", "unknown"].includes(command)
  ) {
    try {
      if (parseArgs(argv).version) command = "version";
    } catch {
      // Invalid invocations remain attributed to their command, as in main().
    }
  }
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
export function installationId(): string | undefined {
  const directory = join(homedir(), ".mcp-use");
  const file = join(directory, "cli-telemetry.json");
  const read = (): string | undefined => {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
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
  const existing = read();
  if (existing !== undefined) return existing;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      temporary,
      JSON.stringify({ installationId: randomUUID() }) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      }
    );
    try {
      // Publish complete contents without replacing a concurrent creator's ID.
      linkSync(temporary, file);
    } catch (error) {
      const raced = read();
      if (raced !== undefined) return raced;
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        return undefined;
      const lock = `${file}.lock`;
      let locked = false;
      try {
        try {
          mkdirSync(lock, { mode: 0o700 });
          locked = true;
        } catch {
          // Repair is synchronous and takes milliseconds. Recover an abandoned
          // lock after a minute, rather than disabling capture after a crash.
          if (Date.now() - statSync(lock).mtimeMs <= 60_000) return read();
          rmdirSync(lock);
          mkdirSync(lock, { mode: 0o700 });
          locked = true;
        }
        // A previous lock holder may already have repaired the file.
        const repaired = read();
        if (repaired !== undefined) return repaired;
        renameSync(temporary, file);
      } finally {
        if (locked) rmdirSync(lock);
      }
    }
    return read();
  } catch {
    // Skip capture when identity storage is unavailable.
    return undefined;
  } finally {
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* Best-effort cleanup. */
    }
  }
}

/** Record one invocation without delaying command execution or surfacing errors. */
export async function captureCliUsage(argv: readonly string[]): Promise<void> {
  if (
    process.env.MCP_USE_ANONYMIZED_TELEMETRY?.toLowerCase() === "false" ||
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
      fetch(posthogEndpoint(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(
          posthogEvent("mcp_use_cli_command", id, commandProperties(argv))
        ),
      }).then(() => undefined),
      timeout,
    ]);
  } catch {
    // Offline, read-only home, or capture failures must never affect a command.
  } finally {
    clearTimeout(timer);
  }
}
