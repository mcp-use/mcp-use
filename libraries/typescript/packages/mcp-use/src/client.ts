import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import { BaseMCPClient } from "./client/base.js";
import type { ExecutionResult } from "./client/codeExecutor.js";
import {
  BaseCodeExecutor,
  E2BCodeExecutor,
  VMCodeExecutor,
} from "./client/codeExecutor.js";
import { CodeModeConnector } from "./client/connectors/codeMode.js";
import {
  createConnectorFromConfig,
  loadConfigFile,
  type ServerConfig,
} from "./config.js";
import type { BaseConnector } from "./connectors/base.js";
import { logger } from "./logging.js";
import { MCPSession } from "./session.js";
import { Tel } from "./telemetry/index.js";
import { getPackageVersion } from "./version.js";

/**
 * Custom function type for code execution in code mode.
 * Allows providing a custom executor implementation.
 */
export type CodeExecutorFunction = (
  code: string,
  timeout?: number
) => Promise<ExecutionResult>;

/**
 * Built-in code executor types.
 * - `"vm"`: Node.js VM-based executor (default, local execution)
 * - `"e2b"`: E2B cloud sandbox executor (secure remote execution)
 */
export type CodeExecutorType = "vm" | "e2b";

/**
 * Configuration options for the VM-based code executor.
 */
export interface VMExecutorOptions {
  /** Maximum execution time in milliseconds. Default: 30000 (30 seconds) */
  timeoutMs?: number;
  /** Memory limit in megabytes. Default: undefined (no limit) */
  memoryLimitMb?: number;
}

/**
 * Configuration options for the E2B cloud sandbox executor.
 */
export interface E2BExecutorOptions {
  /** E2B API key (required). Get one at https://e2b.dev */
  apiKey: string;
  /** Maximum execution time in milliseconds. Default: 300000 (5 minutes) */
  timeoutMs?: number;
}

/**
 * Union type for executor configuration options.
 */
export type ExecutorOptions = VMExecutorOptions | E2BExecutorOptions;

/**
 * Advanced configuration for code execution mode.
 */
export interface CodeModeConfig {
  /** Whether to enable code execution mode */
  enabled: boolean;
  /** Executor type or custom implementation. Defaults to "vm" */
  executor?: CodeExecutorType | CodeExecutorFunction | BaseCodeExecutor;
  /** Type-safe configuration options for the executor */
  executorOptions?: ExecutorOptions;
}

/**
 * Options for configuring MCPClient behavior.
 */
export interface MCPClientOptions {
  /** Enable code execution mode (simple boolean or advanced configuration) */
  codeMode?: boolean | CodeModeConfig;
  /**
   * Optional callback function to handle sampling requests from servers.
   * When provided, the client will declare sampling capability and handle
   * `sampling/createMessage` requests by calling this callback.
   */
  onSampling?: (
    params: CreateMessageRequest["params"]
  ) => Promise<CreateMessageResult>;
  /**
   * @deprecated Use `onSampling` instead. This option will be removed in a future version.
   * Optional callback function to handle sampling requests from servers.
   * When provided, the client will declare sampling capability and handle
   * `sampling/createMessage` requests by calling this callback.
   */
  samplingCallback?: (
    params: CreateMessageRequest["params"]
  ) => Promise<CreateMessageResult>;
  /**
   * Optional callback function to handle elicitation requests from servers.
   * When provided, the client will declare elicitation capability and handle
   * `elicitation/create` requests by calling this callback.
   *
   * Elicitation allows servers to request additional information from users:
   * - Form mode: Collect structured data with JSON schema validation
   * - URL mode: Direct users to external URLs for sensitive interactions
   */
  elicitationCallback?: (
    params: ElicitRequestFormParams | ElicitRequestURLParams
  ) => Promise<ElicitResult>;
}

// Export executor classes and utilities for external use
export {
  BaseCodeExecutor,
  E2BCodeExecutor,
  isVMAvailable,
  VMCodeExecutor,
} from "./client/codeExecutor.js";

// Export MCPSession and related types for CLI and other consumers
export { MCPSession } from "./session.js";
export type { CallToolResult, Notification, Root, Tool } from "./session.js";

/**
 * Node.js-specific MCP client implementation with advanced features.
 *
 * The MCPClient class provides a complete MCP client implementation for Node.js
 * environments, extending {@link BaseMCPClient} with platform-specific capabilities:
 *
 * - **All Connector Types**: Supports Stdio, HTTP, and WebSocket connectors
 * - **Code Execution Mode**: Execute code dynamically using VM or E2B sandboxes
 * - **File System Operations**: Load and save configurations from/to files
 * - **Sampling & Elicitation**: Handle advanced MCP protocol features
 * - **Session Management**: Create and manage multiple server connections
 *
 * @example
 * ```typescript
 * // Basic usage with config file
 * const client = new MCPClient('./mcp-config.json');
 * const session = await client.createSession('my-server');
 * const tools = await session.listTools();
 * ```
 *
 * @example
 * ```typescript
 * // With inline configuration
 * const client = new MCPClient({
 *   mcpServers: {
 *     'filesystem': {
 *       command: 'npx',
 *       args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
 *     }
 *   }
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With code execution mode
 * const client = new MCPClient('./config.json', {
 *   codeMode: {
 *     enabled: true,
 *     executor: 'e2b',
 *     executorOptions: { apiKey: process.env.E2B_API_KEY }
 *   }
 * });
 *
 * const result = await client.executeCode('console.log("Hello!")');
 * ```
 *
 * @see {@link BaseMCPClient} for base client functionality
 * @see {@link MCPSession} for session management
 */
export class MCPClient extends BaseMCPClient {
  /**
   * Gets the mcp-use package version.
   *
   * This static method returns the version string of the installed mcp-use package,
   * which is useful for debugging and compatibility checks.
   *
   * @returns The package version string (e.g., "1.13.2")
   *
   * @example
   * ```typescript
   * console.log(`mcp-use version: ${MCPClient.getPackageVersion()}`);
   * ```
   */
  public static getPackageVersion(): string {
    return getPackageVersion();
  }

  /**
   * Indicates whether code execution mode is enabled.
   *
   * When true, the client provides special tools for executing code dynamically
   * through the {@link executeCode} and {@link searchTools} methods.
   *
   * @example
   * ```typescript
   * if (client.codeMode) {
   *   const result = await client.executeCode('return 2 + 2');
   *   console.log(result.output); // "4"
   * }
   * ```
   */
  public codeMode: boolean = false;
  private _codeExecutor: BaseCodeExecutor | null = null;
  private _customCodeExecutor: CodeExecutorFunction | null = null;
  private _codeExecutorConfig:
    | CodeExecutorType
    | CodeExecutorFunction
    | BaseCodeExecutor = "vm";
  private _executorOptions?: ExecutorOptions;
  private _defaultOnSampling?: (
    params: CreateMessageRequest["params"]
  ) => Promise<CreateMessageResult>;

  private _defaultElicitationCallback?: (
    params: ElicitRequestFormParams | ElicitRequestURLParams
  ) => Promise<ElicitResult>;


  /**
   * Creates a new MCPClient instance.
   *
   * The client can be initialized with either a configuration object, a path to
   * a configuration file, or no configuration at all (servers can be added later
   * using {@link addServer}).
   *
   * @param config - Configuration object or path to JSON config file. If omitted,
   *                 starts with empty configuration
   * @param options - Optional client behavior configuration
   * @param options.codeMode - Enable code execution mode (boolean or advanced config)
   * @param options.onSampling - Callback for handling sampling requests from servers
   * @param options.elicitationCallback - Callback for handling elicitation requests
   *
   * @example
   * ```typescript
   * // From config file
   * const client = new MCPClient('./mcp-config.json');
   * ```
   *
   * @example
   * ```typescript
   * // From inline config
   * const client = new MCPClient({
   *   mcpServers: {
   *     'my-server': {
   *       command: 'node',
   *       args: ['server.js']
   *     }
   *   }
   * });
   * ```
   *
   * @example
   * ```typescript
   * // With code mode enabled
   * const client = new MCPClient('./config.json', {
   *   codeMode: true
   * });
   * ```
   *
   * @example
   * ```typescript
   * // With sampling callback
   * const client = new MCPClient('./config.json', {
   *   onSampling: async (params) => {
   *     // Call your LLM here
   *     return anthropic.messages.create(params);
   *   }
   * });
   * ```
   *
   * @see {@link fromDict} for creating from config object (alternative syntax)
   * @see {@link fromConfigFile} for creating from file (alternative syntax)
   */
  constructor(
    config?: string | Record<string, any>,
    options?: MCPClientOptions
  ) {
    if (config) {
      if (typeof config === "string") {
        super(loadConfigFile(config));
      } else {
        super(config);
      }
    } else {
      super();
    }

    let codeModeEnabled = false;
    let executorConfig:
      | CodeExecutorType
      | CodeExecutorFunction
      | BaseCodeExecutor = "vm";
    let executorOptions: ExecutorOptions | undefined;

    if (options?.codeMode) {
      if (typeof options.codeMode === "boolean") {
        codeModeEnabled = options.codeMode;
        // defaults: executor="vm", executorOptions=undefined
      } else {
        codeModeEnabled = options.codeMode.enabled;
        executorConfig = options.codeMode.executor ?? "vm";
        executorOptions = options.codeMode.executorOptions;
      }
    }

    this.codeMode = codeModeEnabled;
    this._codeExecutorConfig = executorConfig;
    this._executorOptions = executorOptions;
    // Support both new and deprecated names
    this._defaultOnSampling = options?.onSampling ?? options?.samplingCallback;
    if (options?.samplingCallback && !options?.onSampling) {
      console.warn(
        '[MCPClient] The "samplingCallback" option is deprecated. Use "onSampling" instead.'
      );
    }
    this._defaultElicitationCallback = options?.elicitationCallback;
    if (this.codeMode) {
      this._setupCodeModeConnector();
    }

    this._trackClientInit();
  }

  private _trackClientInit(): void {
    const servers = Object.keys(this.config.mcpServers ?? {});
    const hasSamplingCallback = !!this._samplingCallback;
    const hasElicitationCallback = !!this._elicitationCallback;

    Tel.getInstance()
      .trackMCPClientInit({
        codeMode: this.codeMode,
        sandbox: false, // Sandbox not supported in TS yet
        allCallbacks: hasSamplingCallback && hasElicitationCallback,
        verify: false, // No verify option in TS client
        servers,
        numServers: servers.length,
        isBrowser: false, // Node.js MCPClient
      })
      .catch((e) => logger.debug(`Failed to track MCPClient init: ${e}`));
  }

  /**
   * Creates a client instance from a configuration dictionary.
   *
   * This static factory method provides an alternative syntax for creating
   * a client from an inline configuration object.
   *
   * @param cfg - Configuration dictionary with server definitions
   * @param options - Optional client behavior configuration
   * @returns New MCPClient instance
   *
   * @example
   * ```typescript
   * const client = MCPClient.fromDict({
   *   mcpServers: {
   *     'filesystem': {
   *       command: 'npx',
   *       args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
   *     }
   *   }
   * });
   * ```
   *
   * @see {@link constructor} for direct instantiation
   * @see {@link fromConfigFile} for loading from file
   */
  public static fromDict(
    cfg: Record<string, any>,
    options?: MCPClientOptions
  ): MCPClient {
    return new MCPClient(cfg, options);
  }

  /**
   * Creates a client instance from a configuration file.
   *
   * This static factory method loads MCP server configurations from a JSON
   * file and creates a new client instance.
   *
   * @param path - Path to the JSON configuration file
   * @param options - Optional client behavior configuration
   * @returns New MCPClient instance
   * @throws {Error} If the file cannot be read or parsed
   *
   * @example
   * ```typescript
   * const client = MCPClient.fromConfigFile('./mcp-config.json');
   * await client.createAllSessions();
   * ```
   *
   * @example
   * ```typescript
   * // With code mode
   * const client = MCPClient.fromConfigFile('./config.json', {
   *   codeMode: true
   * });
   * ```
   *
   * @see {@link constructor} for direct instantiation
   * @see {@link fromDict} for inline configuration
   */
  public static fromConfigFile(
    path: string,
    options?: MCPClientOptions
  ): MCPClient {
    return new MCPClient(loadConfigFile(path), options);
  }

  /**
   * Saves the current configuration to a file.
   *
   * This Node.js-specific method writes the client's current configuration
   * (including all server definitions) to a JSON file. The directory will be
   * created if it doesn't exist.
   *
   * @param filepath - Path where the configuration file should be saved
   *
   * @example
   * ```typescript
   * const client = new MCPClient();
   * client.addServer('my-server', {
   *   command: 'node',
   *   args: ['server.js']
   * });
   *
   * // Save configuration for later use
   * client.saveConfig('./mcp-config.json');
   * ```
   *
   * @see {@link fromConfigFile} for loading configurations
   */
  public saveConfig(filepath: string): void {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, JSON.stringify(this.config, null, 2), "utf-8");
  }

  /**
   * Create a connector from server configuration (Node.js version)
   * Supports all connector types including StdioConnector
   */
  protected createConnectorFromConfig(
    serverConfig: Record<string, any>
  ): BaseConnector {
    return createConnectorFromConfig(serverConfig, {
      defaultOnSampling: this._defaultOnSampling,
      defaultElicitationCallback: this._defaultElicitationCallback,
    });
  }

  private _setupCodeModeConnector(): void {
    logger.debug("Code mode connector initialized as internal meta server");
    const connector = new CodeModeConnector(this);
    const session = new MCPSession(connector);

    // Register as internal session
    this.sessions["code_mode"] = session;
    this.activeSessions.push("code_mode");
  }

  private _ensureCodeExecutor(): BaseCodeExecutor {
    if (!this._codeExecutor) {
      const config = this._codeExecutorConfig;

      if (config instanceof BaseCodeExecutor) {
        this._codeExecutor = config;
      } else if (typeof config === "function") {
        // Custom function - wrap it
        this._customCodeExecutor = config;
        // Will be handled in executeCode, return a dummy executor
        throw new Error(
          "Custom executor function should be handled in executeCode"
        );
      } else if (config === "e2b") {
        const opts = this._executorOptions as E2BExecutorOptions | undefined;
        if (!opts?.apiKey) {
          logger.warn("E2B executor requires apiKey. Falling back to VM.");
          try {
            this._codeExecutor = new VMCodeExecutor(
              this,
              this._executorOptions as VMExecutorOptions
            );
          } catch (error) {
            throw new Error(
              "VM executor is not available in this environment and E2B API key is not provided. " +
                "Please provide an E2B API key or run in a Node.js environment."
            );
          }
        } else {
          this._codeExecutor = new E2BCodeExecutor(this, opts);
        }
      } else {
        // Default to VM, but fall back to E2B if VM is not available
        try {
          this._codeExecutor = new VMCodeExecutor(
            this,
            this._executorOptions as VMExecutorOptions
          );
        } catch (error) {
          // VM not available (e.g., in Deno), try E2B fallback
          const e2bOpts = this._executorOptions as
            | E2BExecutorOptions
            | undefined;
          const e2bApiKey = e2bOpts?.apiKey || process.env.E2B_API_KEY;

          if (e2bApiKey) {
            logger.info(
              "VM executor not available in this environment. Falling back to E2B."
            );
            this._codeExecutor = new E2BCodeExecutor(this, {
              ...e2bOpts,
              apiKey: e2bApiKey,
            });
          } else {
            throw new Error(
              "VM executor is not available in this environment. " +
                "Please provide an E2B API key via executorOptions or E2B_API_KEY environment variable, " +
                "or run in a Node.js environment."
            );
          }
        }
      }
    }
    return this._codeExecutor;
  }

  /**
   * Executes JavaScript/TypeScript code in a sandboxed environment.
   *
   * This method is only available when code mode is enabled. It executes the
   * provided code in an isolated environment (VM or E2B sandbox) and returns
   * the results including stdout, stderr, and return value.
   *
   * @param code - JavaScript/TypeScript code to execute
   * @param timeout - Optional execution timeout in milliseconds
   * @returns Execution result with output, errors, and return value
   * @throws {Error} If code mode is not enabled
   *
   * @example
   * ```typescript
   * const client = new MCPClient('./config.json', { codeMode: true });
   *
   * const result = await client.executeCode(`
   *   console.log('Hello, world!');
   *   return 2 + 2;
   * `);
   *
   * console.log(result.stdout);      // "Hello, world!\n"
   * console.log(result.returnValue); // 4
   * ```
   *
   * @example
   * ```typescript
   * // With timeout
   * try {
   *   const result = await client.executeCode('while(true) {}', 1000);
   * } catch (error) {
   *   console.log('Execution timed out');
   * }
   * ```
   *
   * @see {@link searchTools} for discovering available tools in code mode
   */
  public async executeCode(
    code: string,
    timeout?: number
  ): Promise<ExecutionResult> {
    if (!this.codeMode) {
      throw new Error("Code execution mode is not enabled");
    }

    // Use custom executor if provided (e.g., for E2B in Cloudflare Workers)
    if (this._customCodeExecutor) {
      return this._customCodeExecutor(code, timeout);
    }

    // Default to VM-based executor
    return this._ensureCodeExecutor().execute(code, timeout);
  }

  /**
   * Searches for available tools across all MCP servers.
   *
   * This method is only available when code mode is enabled. It searches
   * through tools from all active servers and returns matching tools based
   * on the query and detail level.
   *
   * @param query - Optional search query to filter tools (defaults to empty string for all tools)
   * @param detailLevel - Level of detail to return: "names", "descriptions", or "full"
   * @returns Tool search results with matching tools
   * @throws {Error} If code mode is not enabled
   *
   * @example
   * ```typescript
   * const client = new MCPClient('./config.json', { codeMode: true });
   * await client.createAllSessions();
   *
   * // Search for all tools
   * const allTools = await client.searchTools();
   * console.log(`Found ${allTools.tools.length} tools`);
   *
   * // Search for specific tools
   * const fileTools = await client.searchTools('file', 'descriptions');
   * ```
   *
   * @see {@link executeCode} for executing code in code mode
   */
  public async searchTools(
    query: string = "",
    detailLevel: "names" | "descriptions" | "full" = "full"
  ): Promise<import("./client/codeExecutor.js").ToolSearchResponse> {
    if (!this.codeMode) {
      throw new Error("Code execution mode is not enabled");
    }
    return this._ensureCodeExecutor().createSearchToolsFunction()(
      query,
      detailLevel
    );
  }

  /**
   * Gets the names of all configured MCP servers (excluding internal servers).
   *
   * This method overrides the base implementation to filter out internal
   * meta-servers like the code mode server, which is an implementation detail
   * not intended for direct user interaction.
   *
   * @returns Array of user-configured server names
   *
   * @example
   * ```typescript
   * const names = client.getServerNames();
   * console.log(`User servers: ${names.join(', ')}`);
   * // Note: 'code_mode' is excluded even if code mode is enabled
   * ```
   *
   * @see {@link activeSessions} for servers with active sessions
   */
  public getServerNames(): string[] {
    const isCodeModeEnabled = this.codeMode;
    return super.getServerNames().filter((name) => {
      return !isCodeModeEnabled || name !== "code_mode";
    });
  }

  /**
   * Closes the client and cleans up all resources.
   *
   * This method performs a complete cleanup by:
   * 1. Shutting down code executors (VM or E2B sandboxes)
   * 2. Closing all active MCP sessions
   * 3. Releasing any other held resources
   *
   * Always call this method when you're done with the client to ensure
   * proper resource cleanup, especially when using E2B sandboxes which
   * have associated costs.
   *
   * @example
   * ```typescript
   * const client = new MCPClient('./config.json', { codeMode: true });
   * await client.createAllSessions();
   *
   * // Do work...
   *
   * // Clean up
   * await client.close();
   * ```
   *
   * @example
   * ```typescript
   * // Use in shutdown handler
   * process.on('SIGINT', async () => {
   *   console.log('Shutting down...');
   *   await client.close();
   *   process.exit(0);
   * });
   * ```
   *
   * @see {@link closeAllSessions} for closing just the sessions
   */
  public async close(): Promise<void> {
    // Clean up code executor first (e.g., E2B sandboxes)
    if (this._codeExecutor) {
      await this._codeExecutor.cleanup();
      this._codeExecutor = null;
    }

    // Then close all MCP sessions
    await this.closeAllSessions();
  }
}
