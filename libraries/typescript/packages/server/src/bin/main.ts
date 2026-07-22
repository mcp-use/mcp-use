/**
 * Command dispatch for the `mcp-use` bin (specs/CLI_SPEC.md).
 *
 * Every substantial command is dispatched through its own dynamic import.
 * The library entry, bin, and production `start` path therefore never
 * evaluate Vite or an unrelated command implementation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseArgs, type ParsedArgs } from "./args.js";

/**
 * Options this bin passes to the cli's `runDev`/`runBuild`.
 *
 * @internal
 */
export interface CliCommandOptions {
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
  /** Start a public tunnel at dev startup (`--tunnel`). */
  tunnel?: boolean;
  /** Auto-open the inspector in a browser at dev startup (`--no-open` disables). */
  open?: boolean;
  /** Record inspector availability in the build manifest (`--with-inspector`). */
  withInspector?: boolean;
  /** Emit source maps in production build output (`--source-maps`). */
  sourceMaps?: boolean;
  /** Embed production view JS and CSS in MCP resources (`--inline`). */
  inline?: boolean;
}

const HELP = `mcp-use — run MCP servers built with mcp-use

Usage: mcp-use <command> [options]

Commands:
  dev      Start the dev server
  build    Build the server into .mcp-use/build
  start    Serve the production build from .mcp-use/build
  login    Authenticate the cloud CLI
  logout   Delete local cloud credentials
  whoami   Show the authenticated cloud identity
  org      Manage the active organization
  servers  Manage cloud servers and environment variables
  deployments Manage cloud deployments and logs
  deploy   Deploy the current GitHub project
  client   Connect to and invoke MCP servers
  skills   Install maintained coding-agent skills
  screenshot Capture an MCP Apps view

Options:
  -p, --port <n>     Port to serve on (default: $PORT or 3000)
  --host <host>      Host to bind (dev only)
  --entry <path>     Server entry module (dev/build only)
  --path <directory> Project root (default: current directory)
  --mcp-dir <dir>    Directory containing the MCP entry and views/
  --views-dir <dir>  Views directory (default: views/ or <mcp-dir>/views/)
  --with-inspector   Record inspector availability in the build manifest (build only)
  --source-maps      Emit source maps in build output (build only)
  --inline           Embed view JS and CSS in MCP resources (build only)
  --tunnel           Expose the dev server through a public tunnel (dev only)
  --no-open          Do not auto-open the inspector in a browser (dev only)
  -h, --help         Show this help
  -v, --version      Print the version`;

/**
 * Run the `mcp-use` CLI.
 *
 * @param argv - Raw arguments, typically `process.argv.slice(2)`.
 * @returns The process exit code. A `0` from `start`/`dev` means the command
 * launched successfully and the process should stay alive serving.
 *
 * @internal
 */
export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0] ?? "")) {
    console.log(readOwnVersion());
    return 0;
  }
  if (argv.some((token) => token === "--help" || token === "-h")) {
    const command = argv[0];
    if (command === undefined || command === "--help" || command === "-h") {
      console.log(HELP);
      return 0;
    }
  }

  const command = argv[0];
  if (command === "login" || command === "logout" || command === "whoami") {
    const { runIdentity } = await import("../commands/identity.js");
    return runIdentity(command, argv.slice(1));
  }
  if (command === "org") {
    const { runOrganizations } = await import("../commands/organizations.js");
    return runOrganizations(argv.slice(1));
  }
  if (command === "servers") {
    const { runServers } = await import("../commands/servers.js");
    return runServers(argv.slice(1));
  }
  if (command === "deployments") {
    const { runDeployments } = await import("../commands/deployments.js");
    return runDeployments(argv.slice(1));
  }
  if (command === "deploy") {
    const { runDeploy } = await import("../commands/deploy.js");
    return runDeploy(argv.slice(1));
  }
  if (command === "client") {
    const { runClient } = await import("../commands/client.js");
    return runClient(argv.slice(1));
  }
  if (command === "skills") {
    const { runSkills } = await import("../commands/skills.js");
    return runSkills(argv.slice(1));
  }
  if (command === "screenshot") {
    const { runScreenshot } = await import("../commands/screenshot.js");
    return runScreenshot(argv.slice(1));
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (args.version) {
    console.log(readOwnVersion());
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
    case undefined:
      console.error(HELP);
      return 2;
    default:
      console.error(`Unknown command: ${args.command}\n\n${HELP}`);
      return 2;
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
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  console.log(`mcp-use server running at ${started.url}`);

  const shutdown = (): void => {
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
    ...(args.withInspector && { withInspector: true }),
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
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Read this package's own version for `--version`.
 *
 * Probes both layouts — `dist/bin.js` (bundled, package root is one level
 * up) and `src/bin/main.ts` (tests, package root is two levels up) — and
 * verifies the manifest's `name` so an unrelated package.json never wins.
 */
function readOwnVersion(): string {
  for (const relative of ["../package.json", "../../package.json"]) {
    try {
      const raw = readFileSync(new URL(relative, import.meta.url), "utf8");
      const pkg = JSON.parse(raw) as { name?: unknown; version?: unknown };
      if (
        (pkg.name === "mcp-use" || pkg.name === "mcp-use") &&
        typeof pkg.version === "string"
      ) {
        return pkg.version;
      }
    } catch {
      // Not there or unreadable — try the next candidate.
    }
  }
  return "unknown";
}
