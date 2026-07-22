/**
 * Hand-rolled argv parsing for the `mcp-use` bin.
 *
 * Deliberately dependency-free (no commander): the bin must add zero runtime
 * dependencies to the package (see specs/CLI_SPEC.md, dependency rules).
 */
import { resolveListenHost, resolveListenPort } from "../listen-address.js";

/**
 * Result of parsing the `mcp-use` command line.
 *
 * @internal
 */
export interface ParsedArgs {
  /** First positional argument — the subcommand — or `undefined` if none was given. */
  command: string | undefined;
  /** Value of `--port`/`-p`, or `undefined` if the flag was not passed. */
  port: number | undefined;
  /** Value of `--entry`, or `undefined` if the flag was not passed. */
  entry: string | undefined;
  /** Project root selected by `--path`. */
  path: string | undefined;
  /** MCP source directory selected by `--mcp-dir`. */
  mcpDir: string | undefined;
  /** View source directory selected by `--views-dir`. */
  viewsDir: string | undefined;
  /** Value of `--host`, or `undefined` if the flag was not passed. */
  host: string | undefined;
  /** Whether `--tunnel` was passed (dev only). */
  tunnel: boolean;
  /** `false` when `--no-open` was passed (dev only); `true` otherwise. */
  open: boolean;
  /** `false` when `--no-inspector` was passed (dev only); `true` otherwise. */
  inspector: boolean;
  /** Whether `start` should mount the Inspector on the production listener. */
  withInspector: boolean;
  /** Whether build output should include source maps (build only). */
  sourceMaps: boolean;
  /** Whether production view JS and CSS should be embedded in MCP resources. */
  inline: boolean;
  /** Whether `--help`/`-h` was passed. */
  help: boolean;
  /** Whether `--version`/`-v` was passed. */
  version: boolean;
}

/**
 * Parse the `mcp-use` argv (everything after the node binary and script path).
 *
 * Supports `--flag value` and `--flag=value` forms. The first bare token is
 * taken as the subcommand.
 *
 * @param argv - Raw arguments, typically `process.argv.slice(2)`.
 * @throws Error on an unknown flag, a missing flag value, an out-of-range
 * port, or a second positional argument.
 *
 * @internal
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: undefined,
    port: undefined,
    entry: undefined,
    path: undefined,
    mcpDir: undefined,
    viewsDir: undefined,
    host: undefined,
    tunnel: false,
    open: true,
    inspector: true,
    withInspector: false,
    sourceMaps: false,
    inline: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;

    // Split `--flag=value` into flag + inline value.
    let flag = token;
    let inline: string | undefined;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        flag = token.slice(0, eq);
        inline = token.slice(eq + 1);
      }
    }

    /** Consume the flag's value: inline (`=`) or the next argv token. */
    const takeValue = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[++i];
      if (next === undefined || next.startsWith("-")) {
        throw new Error(`Missing value for ${flag}`);
      }
      return next;
    };

    switch (flag) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-v":
      case "--version":
        args.version = true;
        break;
      case "-p":
      case "--port":
        args.port = parsePort(takeValue());
        break;
      case "--entry":
        args.entry = takeValue();
        break;
      case "--path":
        args.path = takeValue();
        break;
      case "--mcp-dir":
        args.mcpDir = takeValue();
        break;
      case "--views-dir":
        args.viewsDir = takeValue();
        break;
      case "--host":
        args.host = takeValue();
        break;
      case "--tunnel":
        args.tunnel = true;
        break;
      case "--no-open":
        args.open = false;
        break;
      case "--no-inspector":
        args.inspector = false;
        break;
      case "--with-inspector":
        args.withInspector = true;
        break;
      case "--source-maps":
        args.sourceMaps = true;
        break;
      case "--inline":
        args.inline = true;
        break;
      default:
        if (flag.startsWith("-")) {
          throw new Error(`Unknown option: ${flag}`);
        }
        if (args.command !== undefined) {
          throw new Error(`Unexpected argument: ${flag}`);
        }
        args.command = flag;
    }
  }

  return args;
}

/**
 * Resolve a CLI port with standard precedence: flag, `PORT`, configured value,
 * then `3000`. `dev` additionally probes upward when the value is taken.
 *
 * A malformed `PORT` is ignored; an invalid `--port` has already been
 * rejected by {@link parseArgs}.
 *
 * @param flagPort - Port from the `--port`/`-p` flag, if given.
 * @param env - Environment to read `PORT` from.
 * @param configuredPort - Code-level fallback from `ServerConfig.port`.
 * @defaultValue `env` defaults to `process.env`.
 *
 * @internal
 */
export function resolvePort(
  flagPort: number | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  configuredPort?: number
): number {
  return resolveListenPort(flagPort, configuredPort, env);
}

/** Resolve a CLI host with standard precedence: flag, `HOST`, code, default. */
export function resolveHost(
  flagHost: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  configuredHost?: string
): string {
  return resolveListenHost(flagHost, configuredHost, env);
}

/** Parse a `--port` value, rejecting anything that is not a valid port. */
function parsePort(value: string): number {
  const port = Number(value);
  if (!isValidPort(port)) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

/** Whether a number is a bindable TCP port (0 = ephemeral). */
function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}
