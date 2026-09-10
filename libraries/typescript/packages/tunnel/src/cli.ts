import { resolve } from "node:path";

import { createTunnelManager, type TunnelManagerOptions } from "./index.js";

/** Parsed standalone tunnel command options. */
interface CliOptions extends TunnelManagerOptions {
  help: boolean;
  port?: number;
}

/** Return standalone command usage text. */
export function usage(): string {
  return [
    "Usage: mcp-tunnel <LOCAL_PORT> [--relay RELAY_URL] [--subdomain SUBDOMAIN]",
    "",
    "Environment:",
    "  MCP_USE_WS_RELAY  Override the WebSocket relay API origin",
  ].join("\n");
}

/** Parse standalone tunnel command arguments. */
export function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = { help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--relay") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--relay requires a URL");
      options.relayUrl = value;
      index += 1;
    } else if (argument === "--subdomain") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--subdomain requires a value");
      options.subdomain = value;
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (options.port === undefined) {
      const port = Number(argument);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Invalid local port: ${argument}`);
      }
      options.port = port;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  return options;
}

/** Run the standalone tunnel command until graceful shutdown. */
export async function runTunnelCli(args: readonly string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.port === undefined) throw new Error(usage());

  const manager = createTunnelManager(
    resolve(process.cwd(), ".mcp-use", "state", "tunnel.json"),
    {
      ...(options.relayUrl !== undefined && { relayUrl: options.relayUrl }),
      ...(options.subdomain !== undefined && { subdomain: options.subdomain }),
      localHostHeader: "localhost",
    }
  );
  const tunnel = await manager.start(options.port);
  console.log(`Tunnel ready: ${tunnel.url}`);

  await new Promise<void>((resolveShutdown) => {
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      void manager.stop().finally(resolveShutdown);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
