/**
 * Command dispatch for the `mcp-use` bin (specs/CLI_SPEC.md).
 *
 * `start` is implemented inline (zero toolchain deps); `dev` and `build` are
 * dispatched via a dynamic `import("../cli/index.js")` — the sibling
 * `dist/cli/index.js` chunk built from `src/cli/*` (its own tsup
 * entry). The import is dynamic, not static, so `start` and every other path
 * through this file never evaluate cli code — and therefore never
 * evaluate `vite`, which the cli chunk imports.
 *
 * `vite` is an *optional* peer dependency of this package (never a regular
 * dependency): npm/pnpm do not auto-install optional peers, so a production
 * `npm i mcp-use` stays lean. When it is missing, the cli chunk's own
 * `import("vite")` (in `cli/build.ts`/`cli/dev.ts`) rejects with
 * `ERR_MODULE_NOT_FOUND`, which propagates here and is classified by
 * {@link isViteMissing} into the actionable install hint below.
 */
import { readFileSync } from "node:fs";

import { parseArgs, type ParsedArgs } from "./args.js";
import { runStart } from "./start.js";

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
  /** Port override (`--port`/`-p`). */
  port?: number;
  /** Host override (`--host`). */
  host?: string;
  /** Start a public tunnel at dev startup (`--tunnel`). */
  tunnel?: boolean;
  /** Auto-open the inspector in a browser at dev startup (`--no-open` disables). */
  open?: boolean;
}

/** The subset of the cli chunk's exports this bin calls. */
interface CliModule {
  runDev(options: CliCommandOptions): Promise<void>;
  runBuild(options: CliCommandOptions): Promise<void>;
}

const HELP = `mcp-use — run MCP servers built with mcp-use

Usage: mcp-use <command> [options]

Commands:
  dev      Start the dev server (requires vite)
  build    Build the server into .mcp-use/build (requires vite)
  start    Serve the production build from .mcp-use/build

Options:
  -p, --port <n>     Port to serve on (default: $PORT or 3000)
  --host <host>      Host to bind (dev only)
  --entry <path>     Server entry module (dev/build only)
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
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
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
      return 1;
    default:
      console.error(`Unknown command: ${args.command}\n\n${HELP}`);
      return 1;
  }
}

/** `mcp-use start`: serve the production build, wire shutdown signals. */
async function startCommand(args: ParsedArgs): Promise<number> {
  let started;
  try {
    started = await runStart({ cwd: process.cwd(), port: args.port });
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

/** `mcp-use dev` / `mcp-use build`: dispatch to the cli chunk. */
async function cliCommand(
  command: "dev" | "build",
  args: ParsedArgs
): Promise<number> {
  const options: CliCommandOptions = {
    cwd: process.cwd(),
    ...(args.entry !== undefined && { entry: args.entry }),
    ...(args.port !== undefined && { port: args.port }),
    ...(args.host !== undefined && { host: args.host }),
    ...(args.tunnel && { tunnel: true }),
    ...(!args.open && { open: false }),
  };

  try {
    const cli = (await import("../cli/index.js")) as CliModule;
    if (command === "dev") {
      await cli.runDev(options);
    } else {
      await cli.runBuild(options);
    }
    return 0;
  } catch (error) {
    if (isViteMissing(error)) {
      console.error(
        `mcp-use ${command} requires Vite. Install it:\n  npm i -D vite`
      );
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Whether `error` is Node's module-resolution failure for the missing,
 * optional `vite` peer dependency, as opposed to any other failure raised
 * while running `dev`/`build` (a bad entry, a Vite build error, …).
 *
 * A missing `vite` surfaces as `ERR_MODULE_NOT_FOUND` naming `'vite'` — the
 * cli chunk's own `import("vite")` rejects before its `runDev`/`runBuild`
 * ever runs, and that rejection propagates through the dynamic
 * `import("../cli/index.js")` in {@link cliCommand} unchanged.
 *
 * @param error - The value caught around the cli dispatch.
 *
 * @internal
 */
export function isViteMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ERR_MODULE_NOT_FOUND" && error.message.includes("'vite'");
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
        (pkg.name === "@mcp-use/server" || pkg.name === "mcp-use") &&
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
