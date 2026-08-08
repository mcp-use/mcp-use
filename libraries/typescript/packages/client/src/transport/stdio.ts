import type {
  ClientOptions,
  VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { Client } from "@modelcontextprotocol/client";
import type { StdioServerParameters } from "@modelcontextprotocol/client/stdio";
import type { Writable } from "node:stream";

import process from "node:process";
import type { ConnectorInitOptions } from "./base.js";

import { logger } from "../utils/logging.js";
import { DialectJsonSchemaValidator } from "../utils/json-schema-validator.js";
import { ConnectionManager } from "./connection-manager.js";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { BaseConnector } from "./base.js";
import type { ClientInfo } from "./http.js";

/**
 * How a spawned server's standard error is handled.
 *
 * - `"pipe"` forwards the child's stderr to the connector's `errlog`.
 * - `"inherit"` hands the parent's stderr file descriptor to the child, which
 *   preserves TTY detection and colorization but bypasses `errlog`.
 * - `"ignore"` discards it.
 *
 * @defaultValue `"pipe"`
 */
export type StdioStderrMode = "pipe" | "inherit" | "ignore";

/** Stdio-specific connector options. */
interface StdioConnectorOptions extends ConnectorInitOptions {
  /** Client identity advertised to the server. */
  clientInfo?: ClientInfo;
  /**
   * Protocol version negotiation mode. Defaults to `"legacy"` for stdio: the
   * SDK docs advise against `"auto"` for spawn-per-invocation CLI/debug tools
   * (a legacy server that never answers unknown pre-`initialize` requests
   * stalls the probe, and the probe round trip perturbs byte-stable
   * transcripts). Opt into `"auto"` or a pin explicitly.
   */
  protocolNegotiation?: VersionNegotiationMode;
}

/**
 * Launches and connects to a local MCP server over standard input and output.
 */
export class StdioConnector extends BaseConnector {
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private readonly cwd?: string;
  private readonly errlog: Writable;
  private readonly stderr: StdioStderrMode;
  private readonly clientInfo: ClientInfo;
  private readonly protocolNegotiation: VersionNegotiationMode;

  /**
   * Creates a stdio connector.
   *
   * @param options - Process launch, client identity, and shared connector options.
   */
  constructor({
    command = "npx",
    args = [],
    env,
    errlog = process.stderr,
    stderr = "pipe",
    ...rest
  }: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    errlog?: Writable;
    /**
     * How the child's standard error is handled. Defaults to `"pipe"` so
     * {@link StdioStderrMode} forwarding to `errlog` works without extra
     * configuration; pass `"inherit"` to keep the child on the parent's
     * stderr file descriptor.
     */
    stderr?: StdioStderrMode;
    cwd?: string;
  } & StdioConnectorOptions = {}) {
    super(rest);

    this.command = command;
    this.args = args;
    this.env = env;
    this.errlog = errlog;
    this.stderr = stderr;
    this.clientInfo = rest.clientInfo ?? {
      name: "stdio-connector",
      version: "1.0.0",
    };
    this.cwd = rest.cwd;
    this.protocolNegotiation = rest.protocolNegotiation ?? "legacy";
  }

  /**
   * Starts the child process and establishes an MCP connection.
   *
   * @returns A promise that resolves after protocol negotiation completes.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug("Already connected to MCP implementation");
      return;
    }

    logger.debug(`Connecting to MCP implementation via stdio: ${this.command}`);
    try {
      // 1. Build server parameters for the transport

      const serverParams: StdioServerParameters = {
        command: this.command,
        args: this.args,
        // The SDK layers explicit values over getDefaultEnvironment(). Passing
        // the configured env through avoids exposing unrelated parent secrets.
        env: this.env,
        cwd: this.cwd,
        stderr: this.stderr,
      };

      // 2. Start the connection manager -> returns a live transport
      this.connectionManager = new StdioConnectionManager(
        serverParams,
        this.errlog
      );
      const transport = await this.connectionManager.start();

      // 3. Create & connect the MCP client
      // Always advertise roots capability - server may query roots/list even if client has no roots
      const clientOptions: ClientOptions = {
        ...(this.opts.clientOptions || {}),
        jsonSchemaValidator:
          this.opts.clientOptions?.jsonSchemaValidator ??
          new DialectJsonSchemaValidator(),
        versionNegotiation: {
          mode: this.protocolNegotiation,
          ...(this.opts.clientOptions?.versionNegotiation ?? {}),
        },
        listChanged: {
          tools: {
            autoRefresh: true,
            onChanged: (error, tools) =>
              void this.handleListChanged(
                "notifications/tools/list_changed",
                error,
                tools
              ),
          },
          resources: {
            autoRefresh: false,
            onChanged: (error) =>
              void this.handleListChanged(
                "notifications/resources/list_changed",
                error
              ),
          },
          prompts: {
            autoRefresh: false,
            onChanged: (error) =>
              void this.handleListChanged(
                "notifications/prompts/list_changed",
                error
              ),
          },
          ...(this.opts.clientOptions?.listChanged ?? {}),
        },
        capabilities: {
          ...(this.opts.clientOptions?.capabilities || {}),
          roots: { listChanged: true }, // Always advertise roots capability
          // Add sampling capability if callback is provided
          ...(this.opts.onSampling ? { sampling: {} } : {}),
          // Add elicitation capability if callback is provided
          ...(this.opts.onElicitation
            ? { elicitation: { form: {}, url: {} } }
            : {}),
        },
      };
      this.client = new Client(this.clientInfo, clientOptions);

      // Register inbound handlers BEFORE connect() so they are available for the
      // entire connection lifetime (including reverse RPC during/after initialize).
      this.setupRootsHandler();
      this.setupSamplingHandler();
      this.setupElicitationHandler();
      logger.debug(
        "Roots/sampling/elicitation handlers registered before connect (stdio)"
      );

      await this.client.connect(transport);
      this.setupRoundProgressForwarding();

      this.connected = true;
      this.setupNotificationHandler();
      // Inbound request handlers (roots/sampling/elicitation) were registered before connect()
      logger.debug(
        `Successfully connected to MCP implementation: ${this.command}`
      );

      // Track connector initialization
      this.trackConnectorInit({
        serverCommand: this.command,
        serverArgs: this.args,
        publicIdentifier: `${this.command} ${this.args.join(" ")}`,
      });
    } catch (err) {
      logger.error(`Failed to connect to MCP implementation: ${err}`);
      await this.cleanupResources();
      throw err;
    }
  }

  /**
   * Returns fields identifying the launched command and arguments.
   *
   * @returns Stdio connector identity metadata.
   */
  get publicIdentifier(): Record<string, string> {
    return {
      type: "stdio",
      "command&args": `${this.command} ${this.args.join(" ")}`,
    };
  }
}

/**
 * Owns the lifecycle of a stdio client transport.
 */
export class StdioConnectionManager extends ConnectionManager<StdioClientTransport> {
  private readonly serverParams: StdioServerParameters;
  private readonly errlog: Writable;
  private _transport: StdioClientTransport | null = null;
  private _stderrSource: NodeJS.ReadableStream | null = null;
  private readonly _onErrlogError = (error: Error): void => {
    logger.warn(`Error writing child stderr to errlog: ${error}`);
  };

  /**
   * Creates a connection manager for a local server process.
   *
   * @param serverParams - Process parameters passed to the SDK transport.
   * @param errlog - Destination for the child process's standard error stream.
   */
  constructor(
    serverParams: StdioServerParameters,
    errlog: Writable = process.stderr
  ) {
    super();
    this.serverParams = serverParams;
    this.errlog = errlog;
  }

  protected async establishConnection(): Promise<StdioClientTransport> {
    // The SDK defaults stderr to "inherit", which leaves `transport.stderr`
    // null and makes the forwarding below dead code. Default to "pipe" so
    // `errlog` works without extra configuration. The coalesce is applied
    // after the spread on purpose: an explicit `stderr: undefined` in
    // serverParams would otherwise defeat the default.
    const stderr = this.serverParams.stderr ?? "pipe";
    this._transport = new StdioClientTransport({
      ...this.serverParams,
      stderr,
    });

    // Only "pipe" leaves a readable stream; "inherit" and "ignore" do not.
    const childStderr = this._transport.stderr;
    if (stderr === "pipe" && childStderr && "pipe" in childStderr) {
      this._stderrSource = childStderr as unknown as NodeJS.ReadableStream;
      // `errlog` is caller-owned and may be reused across reconnects, so the
      // child exiting must not end it. Without a handler, a destroyed errlog
      // would surface as an unhandled 'error' event.
      this._stderrSource.on("error", (error) => {
        logger.warn(`Error forwarding child stderr: ${error}`);
      });
      this.errlog.on("error", this._onErrlogError);
      this._stderrSource.pipe(this.errlog, { end: false });
    }

    logger.debug(`${this.constructor.name} connected successfully`);
    return this._transport;
  }

  protected async closeConnection(
    _connection: StdioClientTransport
  ): Promise<void> {
    if (this._stderrSource) {
      this._stderrSource.unpipe(this.errlog);
      this.errlog.off("error", this._onErrlogError);
      this._stderrSource = null;
    }
    if (this._transport) {
      try {
        await this._transport.close();
      } catch (e) {
        logger.warn(`Error closing stdio transport: ${e}`);
      } finally {
        this._transport = null;
      }
    }
  }
}
