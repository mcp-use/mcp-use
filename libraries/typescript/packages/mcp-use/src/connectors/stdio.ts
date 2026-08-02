import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Writable } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import process from "node:process";
import type { ConnectorInitOptions } from "./base.js";

import { logger } from "../logging.js";
import { StdioConnectionManager } from "../task_managers/stdio.js";
import { BaseConnector } from "./base.js";
import type { ClientInfo } from "./http.js";

interface StdioConnectorOptions extends ConnectorInitOptions {
  clientInfo?: ClientInfo;
}

export class StdioConnector extends BaseConnector {
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private readonly cwd?: string;
  private readonly errlog: Writable;
  private readonly clientInfo: ClientInfo;

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

      // Pass env directly without inheriting the full process.env.
      // When env is undefined, the MCP SDK applies its own default environment
      // (HOME, PATH, etc.) via getDefaultEnvironment(), matching the Python
      // connector behavior. This avoids silently leaking parent secrets
      // (API keys, cloud credentials) into the child process when the user
      // configures even a single env var. See GHSA discussion on #1901.
      const serverParams: StdioServerParameters = {
        command: this.command,
        args: this.args,
        env: this.env,
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
      const clientOptions = {
        ...(this.opts.clientOptions || {}),
        capabilities: {
          ...(this.opts.clientOptions?.capabilities || {}),
          roots: { listChanged: true }, // Always advertise roots capability
          // Add sampling capability if callback is provided
          ...((this.opts.onSampling ?? this.opts.samplingCallback)
            ? { sampling: {} }
            : {}),
          // Add elicitation capability if callback is provided
          ...((this.opts.onElicitation ?? this.opts.elicitationCallback)
            ? { elicitation: { form: {}, url: {} } }
            : {}),
        },
      };
      this.client = new Client(this.clientInfo, clientOptions);
      await this.client.connect(transport);

      this.connected = true;
      this.setupNotificationHandler();
      this.setupRootsHandler();
      this.setupSamplingHandler();
      this.setupElicitationHandler();
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
