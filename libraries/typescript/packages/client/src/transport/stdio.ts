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

interface StdioConnectorOptions extends ConnectorInitOptions {
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

export class StdioConnector extends BaseConnector {
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private readonly cwd?: string;
  private readonly errlog: Writable;
  private readonly clientInfo: ClientInfo;
  private readonly protocolNegotiation: VersionNegotiationMode;

  constructor({
    command = "npx",
    args = [],
    env,
    errlog = process.stderr,
    ...rest
  }: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    errlog?: Writable;
    cwd?: string;
  } & StdioConnectorOptions = {}) {
    super(rest);

    this.command = command;
    this.args = args;
    this.env = env;
    this.errlog = errlog;
    this.clientInfo = rest.clientInfo ?? {
      name: "stdio-connector",
      version: "1.0.0",
    };
    this.cwd = rest.cwd;
    this.protocolNegotiation = rest.protocolNegotiation ?? "legacy";
  }

  /** Establish connection to the MCP implementation. */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug("Already connected to MCP implementation");
      return;
    }

    logger.debug(`Connecting to MCP implementation via stdio: ${this.command}`);
    try {
      // 1. Build server parameters for the transport

      // Merge env with process.env, filtering out undefined values
      let mergedEnv: Record<string, string> | undefined;
      if (this.env) {
        mergedEnv = {};
        // First add process.env values (excluding undefined)
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) {
            mergedEnv[key] = value;
          }
        }
        // Then override with provided env
        Object.assign(mergedEnv, this.env);
      }

      const serverParams: StdioServerParameters = {
        command: this.command,
        args: this.args,
        env: mergedEnv,
        cwd: this.cwd,
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

  get publicIdentifier(): Record<string, string> {
    return {
      type: "stdio",
      "command&args": `${this.command} ${this.args.join(" ")}`,
    };
  }
}

export class StdioConnectionManager extends ConnectionManager<StdioClientTransport> {
  private readonly serverParams: StdioServerParameters;
  private readonly errlog: Writable;
  private _transport: StdioClientTransport | null = null;

  constructor(
    serverParams: StdioServerParameters,
    errlog: Writable = process.stderr
  ) {
    super();
    this.serverParams = serverParams;
    this.errlog = errlog;
  }

  protected async establishConnection(): Promise<StdioClientTransport> {
    this._transport = new StdioClientTransport(this.serverParams);

    if (
      this._transport.stderr &&
      typeof (this._transport.stderr as any).pipe === "function"
    ) {
      (this._transport.stderr as unknown as NodeJS.ReadableStream).pipe(
        this.errlog
      );
    }

    logger.debug(`${this.constructor.name} connected successfully`);
    return this._transport;
  }

  protected async closeConnection(
    _connection: StdioClientTransport
  ): Promise<void> {
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
