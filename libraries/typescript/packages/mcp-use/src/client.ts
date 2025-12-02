import fs from "node:fs";
import path from "node:path";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { BaseMCPClient } from "./client/base.js";
import type { ExecutionResult } from "./client/codeExecutor.js";
import {
  BaseCodeExecutor,
  E2BCodeExecutor,
  VMCodeExecutor,
} from "./client/codeExecutor.js";
import { CodeModeConnector } from "./client/connectors/codeMode.js";
import { createConnectorFromConfig, loadConfigFile } from "./config.js";
import type { BaseConnector } from "./connectors/base.js";
import { logger } from "./logging.js";
import { MCPSession } from "./session.js";

export type CodeExecutorFunction = (
  code: string,
  timeout?: number
) => Promise<ExecutionResult>;
export type CodeExecutorType = "vm" | "e2b";

// Separate option types for each executor
export interface VMExecutorOptions {
  timeoutMs?: number; // Default: 30000 (30 seconds)
  memoryLimitMb?: number; // Default: undefined (no limit)
}

export interface E2BExecutorOptions {
  apiKey: string; // Required
  timeoutMs?: number; // Default: 300000 (5 minutes)
}

// Union type for executor options
export type ExecutorOptions = VMExecutorOptions | E2BExecutorOptions;

export interface CodeModeConfig {
  enabled: boolean;
  executor?: CodeExecutorType | CodeExecutorFunction | BaseCodeExecutor; // defaults to "vm"
  executorOptions?: ExecutorOptions; // Type-safe based on executor
}

export interface MCPClientOptions {
  codeMode?: boolean | CodeModeConfig;
  /**
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

/**
 * Node.js-specific MCPClient implementation
 *
 * Extends the base client with Node.js-specific features like:
 * - File system operations (saveConfig)
 * - Config file loading (fromConfigFile)
 * - All connector types including StdioConnector
 * - Code execution mode
 */
export class MCPClient extends BaseMCPClient {
  public codeMode: boolean = false;
  private _codeExecutor: BaseCodeExecutor | null = null;
  private _customCodeExecutor: CodeExecutorFunction | null = null;
  private _codeExecutorConfig:
    | CodeExecutorType
    | CodeExecutorFunction
    | BaseCodeExecutor = "vm";
  private _executorOptions?: ExecutorOptions;
  private _samplingCallback?: (
    params: CreateMessageRequest["params"]
  ) => Promise<CreateMessageResult>;

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
    this._samplingCallback = options?.samplingCallback;

    if (this.codeMode) {
      this._setupCodeModeConnector();
    }
  }

  public static fromDict(
    cfg: Record<string, any>,
    options?: MCPClientOptions
  ): MCPClient {
    return new MCPClient(cfg, options);
  }

  public static fromConfigFile(
    path: string,
    options?: MCPClientOptions
  ): MCPClient {
    return new MCPClient(loadConfigFile(path), options);
  }

  /**
   * Save configuration to a file (Node.js only)
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
      samplingCallback: this._samplingCallback,
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
   * Execute code in code mode
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
   * Search available tools (used by code mode)
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
   * Override getServerNames to exclude internal code_mode server
   */
  public getServerNames(): string[] {
    const isCodeModeEnabled = this.codeMode;
    return super.getServerNames().filter((name) => {
      return !isCodeModeEnabled || name !== "code_mode";
    });
  }

  /**
   * Close the client and clean up resources including code executors.
   * This ensures E2B sandboxes and other resources are properly released.
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
