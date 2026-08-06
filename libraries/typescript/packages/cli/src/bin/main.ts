/**
 * Command dispatch for the `mcp-use` bin (specs/CLI_SPEC.md).
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

const HELP = `mcp-use — run MCP servers built with mcp-use

Usage: mcp-use <command> [options]

Commands:
  dev      Start the dev server
  build    Build the server into .mcp-use/build
  typecheck Refresh MCP types and run the project's TypeScript compiler
  start    Serve the production build from .mcp-use/build
  login    Authenticate the cloud CLI
  logout   Log out of the cloud CLI
  whoami   Show the authenticated cloud identity
  org      Manage the active organization
  servers  Manage cloud servers and environment variables
  deployments Manage cloud deployments and logs
  deploy   Deploy from GitHub or upload local source
  client   Connect to and invoke MCP servers
  screenshot Capture an MCP Apps view

Options:
  -p, --port <n>     Port to serve on (dev/start; default: $PORT or 3000)
  --host <host>      Host to bind (dev/start; default: $HOST or 127.0.0.1)
  --entry <path>     Server entry module (dev/build/typecheck only)
  --path <directory> Project root (default: current directory)
  --mcp-dir <dir>    Directory containing the MCP entry and views/
  --views-dir <dir>  Views directory (default: views/ or <mcp-dir>/views/)
  --source-maps      Emit source maps in build output (build only)
  --inline           Embed view JS and CSS in MCP resources (build only)
  -- <tsc options>   Forward remaining options to TypeScript (typecheck only)
  --with-inspector   Mount Inspector on the production listener (start only)
  --tunnel           Expose the server through a public tunnel (dev/start only)
  --no-open          Do not auto-open the inspector in a browser (dev only)
  --no-inspector     Start dev without loading the optional Inspector
  -h, --help         Show this help
  -v, --version      Print the version`;

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
  if (command === "login" || command === "logout" || command === "whoami") {
    const { runIdentity } = await import("../commands/identity.js");
    return runIdentity(command, commandArgs);
  }
  if (command === "org") {
    const { runOrganizations } = await import("../commands/organizations.js");
    return runOrganizations(commandArgs);
  }
  if (command === "servers") {
    const { runServers } = await import("../commands/servers.js");
    return runServers(commandArgs);
  }
  if (command === "deployments") {
    const { runDeployments } = await import("../commands/deployments.js");
    return runDeployments(commandArgs);
  }
  if (command === "deploy") {
    const { runDeploy } = await import("../commands/deploy.js");
    return runDeploy(commandArgs);
  }
  if (command === "client") {
    const { runClient } = await import("../commands/client.js");
    return runClient(commandArgs);
  }
  if (command === "screenshot") {
    const { runScreenshot } = await import("../commands/screenshot.js");
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
    const { runTypecheck } = await import("../commands/typecheck.js");
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
    const { runStart } = await import("../commands/start.js");
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
      const { runDev } = await import("../commands/dev.js");
      await runDev(options);
    } else {
      const { runBuild } = await import("../commands/build.js");
      await runBuild(options);
    }
    return 0;
  } catch (error) {
    console.error(formatRuntimeError(error));
    return 1;
  }
}

function formatRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
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
