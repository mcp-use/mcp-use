/**
 * Command dispatch for the `mcp-use` bin.
 *
 * Every substantial command is dispatched through its own dynamic import.
 * The library entry, bin, and production `start` path therefore never
 * evaluate Vite or an unrelated command implementation.
 */
import { resolve } from "node:path";

import {
  parseArgs,
  stripForwardingSeparator,
  type ParsedArgs,
} from "./args.js";

// Node 25 exposes `localStorage` through a warning-producing lazy getter when
// no --localstorage-file is configured. CLI/server code does not use that
// browser store, so shadow it before any optional client or Inspector module
// can probe the global.
const nodeLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);
if (nodeLocalStorage?.get !== undefined && nodeLocalStorage.configurable) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: nodeLocalStorage.enumerable ?? false,
    value: undefined,
    writable: true,
  });
}

/**
 * Options this bin passes to the cli's `runDev`/`runBuild`.
 *
 * @internal
 */
interface CliCommandOptions {
  /** Project root the command operates on (`process.cwd()`). */
  cwd: string;
  /** Server entry module override (`--entry`). */
  entry?: string;
  /** MCP source directory (`--mcp-dir`), relative to the project root. */
  mcpDir?: string;
  /** View source directory (`--views-dir`), relative to the project root. */
  viewsDir?: string;
  /** Discover the project's Vite config for production views. Defaults to `true`. */
  viewsConfig?: boolean;
  /** Port override (`--port`/`-p`). */
  port?: number;
  /** Host override (`--host`). */
  host?: string;
  /** Start a public tunnel at dev/start startup (`--tunnel`). */
  tunnel?: boolean;
  /** Auto-open the inspector in a browser at dev startup (`--no-open` disables). */
  open?: boolean;
  /** Load the project-local Inspector (`--no-inspector` disables). */
  inspector?: boolean;
  /** Emit source maps in production build output (`--source-maps`). */
  sourceMaps?: boolean;
  /** Embed production view JS and CSS in MCP resources (`--inline`). */
  inline?: boolean;
}

/** Metadata owned by the package invoking the shared CLI dispatcher. */
export interface CliMainOptions {
  /** Version printed by `--version`. */
  frameworkVersion: string;
}

const HELP = `mcp-use — develop MCP servers and manage Manufact Cloud

Usage: mcp-use <command> [options]

Local development:
  dev          Start the dev server
  build        Build the server into .mcp-use/build
  start        Serve the production build
  typecheck    Refresh MCP types and run the project's TypeScript compiler

Cloud projects:
  deploy       Deploy from GitHub, upload source, or register an MCP endpoint
  link         Link this project to a Cloud server
  unlink       Remove this project's Cloud link
  servers      Manage servers and deployment settings
  deployments  Inspect and manage deployments
  env          Manage environment variables
  logs         Read build and runtime logs
  domains      Manage server domains
  github       Manage GitHub App access
  alerts       Manage alert rules
  checklist    Run publishing checks

Account:
  login        Sign in to Manufact Cloud
  logout       Sign out
  whoami       Show the authenticated identity
  org          Manage organizations and choose the active organization

Tools:
  client       Connect to and invoke MCP servers
  screenshot   Capture an MCP Apps view
  skills       Install version-matched coding agent skills
  help         Show help for a command

Options:
  -h, --help     Show help
  -v, --version  Print the version

Examples:
  mcp-use org --help
  mcp-use org use --help
  mcp-use help deploy

Run 'mcp-use <command> --help' for command-specific options.`;

const LOCAL_HELP: Record<string, string> = {
  dev: `Usage: mcp-use dev [options]

Start the development MCP server with view hot reload.

Options:
  -p, --port <n>     Listener port (default: $PORT or 3000)
  --host <host>      Bind host (default: $HOST or 127.0.0.1)
  --path <directory> Project root (default: current directory)
  --entry <path>     Server entry module
  --mcp-dir <dir>    Directory containing the entry and views/
  --views-dir <dir>  Views directory
  --tunnel           Start a public tunnel
  --no-open          Do not open Inspector
  --no-inspector     Do not load Inspector
  -h, --help         Show this help

Exit codes: 0 started/help, 2 invalid arguments, 1 startup failure`,
  build: `Usage: mcp-use build [options]

Build the MCP server into .mcp-use/build.

Options:
  --path <directory> Project root (default: current directory)
  --entry <path>     Server entry module
  --mcp-dir <dir>    Directory containing the entry and views/
  --views-dir <dir>  Views directory
  --source-maps      Emit source maps
  --no-views-config  Do not load the project's Vite config for views
  --inline           Embed view JavaScript and CSS in MCP resources
  -h, --help         Show this help

Exit codes: 0 built/help, 2 invalid arguments, 1 build failure`,
  typecheck: `Usage: mcp-use typecheck [options] [-- <tsc options>]

Refresh MCP types and run the selected project's TypeScript compiler.

Options:
  --path <directory> Project root (default: current directory)
  --entry <path>     Server entry module
  --mcp-dir <dir>    Directory containing the MCP entry
  -- <tsc options>   Forward remaining options to TypeScript
  -h, --help         Show this help

Exit codes: 0 passed/help, 2 invalid arguments, otherwise the compiler or operational exit code`,
  start: `Usage: mcp-use start [options]

Serve the production build from .mcp-use/build.

Options:
  -p, --port <n>     Listener port (default: $PORT or 3000)
  --host <host>      Bind host (default: $HOST or 127.0.0.1)
  --path <directory> Project root (default: current directory)
  --with-inspector   Mount Inspector on the production listener
  --tunnel           Start a public tunnel
  -h, --help         Show this help

Exit codes: 0 started/help, 2 invalid arguments, 1 startup failure`,
};

/**
 * Run the `mcp-use` CLI.
 *
 * @param argv - Raw arguments, typically `process.argv.slice(2)`.
 * @returns The process exit code. A `0` from `start`/`dev` means the command
 * launched successfully and the process should stay alive serving.
 *
 * @internal
 */
export async function main(
  argv: readonly string[],
  options: CliMainOptions = { frameworkVersion: "unknown" }
): Promise<number> {
  if (argv[0] === "help") {
    return main([...argv.slice(1), "--help"], options);
  }
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0] ?? "")) {
    console.log(options.frameworkVersion);
    return 0;
  }
  if (argv.some((token) => token === "--help" || token === "-h")) {
    const command = argv[0];
    if (command === undefined || command === "--help" || command === "-h") {
      console.log(HELP);
      return 0;
    }
    const localHelp = LOCAL_HELP[command];
    if (localHelp !== undefined) {
      console.log(localHelp);
      return 0;
    }
  }

  const command = argv[0];
  const commandArgs = stripForwardingSeparator(argv.slice(1));
  if (command === "login") {
    const { runLogin } = await import("../cloud/auth/login.js");
    return runLogin(commandArgs);
  }
  if (command === "logout") {
    const { runLogout } = await import("../cloud/auth/logout.js");
    return runLogout(commandArgs);
  }
  if (command === "whoami") {
    const { runWhoami } = await import("../cloud/auth/whoami.js");
    return runWhoami(commandArgs);
  }
  if (command === "alerts") {
    const { runAlerts } = await import("../cloud/alerts/index.js");
    return runAlerts(commandArgs);
  }
  if (command === "checklist") {
    const { runChecklist } = await import("../cloud/checklist/index.js");
    return runChecklist(commandArgs);
  }
  if (command === "domains") {
    const { runDomains } = await import("../cloud/domains/index.js");
    return runDomains(commandArgs);
  }
  if (command === "github") {
    const { runGithub } = await import("../cloud/github/index.js");
    return runGithub(commandArgs);
  }
  if (command === "org") {
    const { runOrganizations } = await import("../cloud/org/index.js");
    return runOrganizations(commandArgs);
  }
  if (command === "servers") {
    const { runServers } = await import("../cloud/servers/index.js");
    return runServers(commandArgs);
  }
  if (command === "deployments") {
    const { runDeployments } = await import("../cloud/deployments/index.js");
    return runDeployments(commandArgs);
  }
  if (command === "env") {
    const { runEnv } = await import("../cloud/environment/index.js");
    return runEnv(commandArgs);
  }
  if (command === "logs") {
    const { runLogs } = await import("../cloud/logs/index.js");
    return runLogs(commandArgs);
  }
  if (command === "link") {
    const { runLink } = await import("../cloud/project/link.js");
    return runLink(commandArgs);
  }
  if (command === "unlink") {
    const { runUnlink } = await import("../cloud/project/unlink.js");
    return runUnlink(commandArgs);
  }
  if (command === "deploy") {
    const { runDeploy } = await import("../cloud/deploy/index.js");
    return runDeploy(commandArgs);
  }
  if (command === "skills") {
    const { runSkills } = await import("../skills/install.js");
    return runSkills(commandArgs);
  }
  if (command === "client") {
    const { runClient } = await import("../client/client.js");
    return runClient(commandArgs);
  }
  if (command === "screenshot") {
    const { runScreenshot } = await import("../client/screenshot.js");
    return runScreenshot(commandArgs);
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (args.version) {
    console.log(options.frameworkVersion);
    return 0;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }

  switch (args.command) {
    case "start":
      return startCommand(args);
    case "dev":
    case "build":
      return cliCommand(args.command, args);
    case "typecheck":
      return typecheckCommand(args);
    case undefined:
      console.error(HELP);
      return 2;
    default:
      console.error(`Unknown command: ${args.command}\n\n${HELP}`);
      return 2;
  }
}

/** `mcp-use typecheck`: refresh MCP types, then run project-local `tsc`. */
async function typecheckCommand(args: ParsedArgs): Promise<number> {
  try {
    const { runTypecheck } = await import("../toolchain/commands/typecheck.js");
    return await runTypecheck({
      cwd: resolve(process.cwd(), args.path ?? "."),
      ...(args.entry !== undefined && { entry: args.entry }),
      ...(args.mcpDir !== undefined && { mcpDir: args.mcpDir }),
      ...(args.passthrough.length > 0 && { tscArgs: args.passthrough }),
    });
  } catch (error) {
    console.error(formatRuntimeError(error));
    return 1;
  }
}

/** `mcp-use start`: serve the production build, wire shutdown signals. */
async function startCommand(args: ParsedArgs): Promise<number> {
  let started;
  try {
    const { runStart } = await import("../toolchain/commands/start.js");
    started = await runStart({
      cwd: resolve(process.cwd(), args.path ?? "."),
      port: args.port,
      host: args.host,
      ...(args.inspector === true && { withInspector: true }),
      tunnel: args.tunnel,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  console.log(`mcp-use server running at ${started.url}`);
  if (args.inspector === true) {
    console.log(
      `mcp-use inspector at ${started.url.replace(/\/$/, "")}/inspector`
    );
  }
  if (started.tunnelUrl !== undefined) {
    console.log(`mcp-use public MCP URL: ${started.tunnelUrl}`);
  }

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    started.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return 0;
}

/** `mcp-use dev` / `mcp-use build`: dispatch to dedicated command chunks. */
async function cliCommand(
  command: "dev" | "build",
  args: ParsedArgs
): Promise<number> {
  const options: CliCommandOptions = {
    cwd: resolve(process.cwd(), args.path ?? "."),
    ...(args.entry !== undefined && { entry: args.entry }),
    ...(args.mcpDir !== undefined && { mcpDir: args.mcpDir }),
    ...(args.viewsDir !== undefined && { viewsDir: args.viewsDir }),
    ...(!args.viewsConfig && { viewsConfig: false }),
    ...(args.port !== undefined && { port: args.port }),
    ...(args.host !== undefined && { host: args.host }),
    ...(args.tunnel && { tunnel: true }),
    ...(!args.open && { open: false }),
    ...(args.inspector === false && { inspector: false }),
    ...(args.sourceMaps && { sourceMaps: true }),
    ...(args.inline && { inline: true }),
  };

  try {
    if (command === "dev") {
      const { runDev } = await import("../toolchain/commands/dev.js");
      await runDev(options);
    } else {
      const { runBuild } = await import("../toolchain/commands/build.js");
      await runBuild(options);
    }
    return 0;
  } catch (error) {
    console.error(formatRuntimeError(error));
    return 1;
  }
}

/**
 * An error's message. Node reports a refused connection as an AggregateError
 * with an empty message and one inner error per address tried, so an empty
 * message falls back to the inner errors.
 */
function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.message !== "") return error.message;
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map(errorMessage).join("; ");
  }
  return String(error);
}

function formatRuntimeError(error: unknown): string {
  const message = errorMessage(error);
  if (/tunnel/i.test(message)) {
    return [
      "[tunnel_connection_timeout] Public tunnel could not establish a connection.",
      `Cause: ${message}`,
      "",
      "Retry:",
      "  mcp-use dev --tunnel",
      "",
      "Verify outbound network access and relay health:",
      "  https://api.tunnel.mcp-use.run/health",
    ].join("\n");
  }
  return message;
}
