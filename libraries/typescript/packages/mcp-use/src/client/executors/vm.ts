import type { MCPClient, VMExecutorOptions } from "../../client.js";
import { logger } from "../../logging.js";
import { BaseCodeExecutor, type ExecutionResult } from "./base.js";

// Lazy-loaded VM module - may not be available in all environments (e.g., Deno)
let vm: any = null;
let vmCheckAttempted = false;

/**
 * Attempt to load the node:vm module synchronously
 * @returns true if successful, false otherwise
 */
function tryLoadVM(): boolean {
  if (vmCheckAttempted) {
    return vm !== null;
  }

  vmCheckAttempted = true;

  try {
    // Try synchronous require first (CommonJS)
    const nodeRequire = typeof require !== "undefined" ? require : null;
    if (nodeRequire) {
      vm = nodeRequire("node:vm");
      return true;
    }
  } catch (error) {
    // Not available or in ESM-only environment
    logger.debug("node:vm module not available via require");
  }

  return false;
}

/**
 * Async version to load VM module via dynamic import
 */
async function tryLoadVMAsync(): Promise<boolean> {
  if (vm !== null) {
    return true;
  }

  // If sync require failed, try async import
  if (!vmCheckAttempted) {
    // Try sync first
    if (tryLoadVM()) {
      return true;
    }
  }

  try {
    // Try ESM dynamic import
    vm = await import("node:vm");
    return true;
  } catch (error) {
    logger.debug(
      "node:vm module not available in this environment (e.g., Deno)"
    );
    return false;
  }
}

/**
 * Check if VM executor is available in the current environment
 * This is a synchronous check that returns true if vm was already loaded
 */
export function isVMAvailable(): boolean {
  tryLoadVM();
  return vm !== null;
}

/**
 * VM-based code executor using Node.js vm module.
 * Executes code in an isolated V8 context with access to MCP tools.
 */
export class VMCodeExecutor extends BaseCodeExecutor {
  private defaultTimeout: number;
  private memoryLimitMb?: number;

  constructor(client: MCPClient, options?: VMExecutorOptions) {
    super(client);
    this.defaultTimeout = options?.timeoutMs ?? 30000;
    this.memoryLimitMb = options?.memoryLimitMb;

    // Try to load VM synchronously - will throw in execute() if not available
    tryLoadVM();
  }

  /**
   * Ensure VM module is loaded before execution
   */
  private async ensureVMLoaded(): Promise<void> {
    if (vm !== null) {
      return;
    }

    const loaded = await tryLoadVMAsync();
    if (!loaded) {
      throw new Error(
        "node:vm module is not available in this environment. " +
          "Please use E2B executor instead or run in a Node.js environment."
      );
    }
  }

  /**
   * Execute JavaScript/TypeScript code with access to MCP tools.
   *
   * @param code - Code to execute
   * @param timeout - Execution timeout in milliseconds (default: configured timeout or 30000)
   */
  async execute(code: string, timeout?: number): Promise<ExecutionResult> {
    const effectiveTimeout = timeout ?? this.defaultTimeout;

    // Ensure VM module is loaded
    await this.ensureVMLoaded();

    // Ensure all servers are connected
    await this.ensureServersConnected();

    const logs: string[] = [];
    const startTime = Date.now();
    let result: any = null;
    let error: string | null = null;

    try {
      // Build execution context (sandbox)
      const context = await this._buildContext(logs);

      // Wrap code in an async function to allow await
      // We use a wrapper to capture the return value
      const wrappedCode = `
        (async () => {
          try {
            ${code}
          } catch (e) {
            throw e;
          }
        })()
      `;

      // Create a script
      const script = new vm.Script(wrappedCode, {
        filename: "agent_code.js",
      });

      // Execute with timeout
      const promise = script.runInNewContext(context, {
        timeout: effectiveTimeout,
        displayErrors: true,
      });

      result = await promise;
    } catch (e: any) {
      error = e.message || String(e);
      // Check for timeout error
      // Check for vm timeout specific error message
      if (
        e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ||
        e.message === "Script execution timed out." ||
        (typeof error === "string" &&
          (error.includes("timed out") || error.includes("timeout")))
      ) {
        error = "Script execution timed out";
      }
      // Capture stack trace if available for debugging (optional)
      if (e.stack) {
        logger.debug(`Code execution error stack: ${e.stack}`);
      }
    }

    const executionTime = (Date.now() - startTime) / 1000;

    return {
      result,
      logs,
      error,
      execution_time: executionTime,
    };
  }

  /**
   * Build the VM execution context with MCP tools and standard globals.
   *
   * @param logs - Array to capture console output
   */
  private async _buildContext(logs: string[]): Promise<any> {
    // Helper to capture logs
    const logHandler = (...args: unknown[]) => {
      logs.push(
        args
          .map((arg) =>
            typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
          )
          .join(" ")
      );
    };

    // Basic safe globals
    const sandbox: Record<string, unknown> = {
      console: {
        log: logHandler,
        error: (...args: unknown[]) => {
          logHandler("[ERROR]", ...args);
        },
        warn: (...args: unknown[]) => {
          logHandler("[WARN]", ...args);
        },
        info: logHandler,
        debug: logHandler,
      },
      // Standard globals
      Object,
      Array,
      String,
      Number,
      Boolean,
      Date,
      Math,
      JSON,
      RegExp,
      Map,
      Set,
      Promise,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURI,
      decodeURI,
      encodeURIComponent,
      decodeURIComponent,
      setTimeout,
      clearTimeout,
      // Helper for tools
      search_tools: this.createSearchToolsFunction(),
      __tool_namespaces: [],
    };

    // Add tool namespaces
    const toolNamespaces: Record<string, boolean> = {};
    const namespaceInfos = this.getToolNamespaces();

    for (const { serverName, tools, session } of namespaceInfos) {
      // Create namespace object with tool functions
      type ToolFunction = (args?: Record<string, unknown>) => Promise<unknown>;
      const serverNamespace: Record<string, ToolFunction> = {};

      for (const tool of tools) {
        const toolName = tool.name;
        // Create wrapper function that calls MCP tool and extracts result
        serverNamespace[toolName] = async (args?: Record<string, unknown>) => {
          const result = await session.connector.callTool(toolName, args || {});

          // Extract content from MCP result
          if (result.content && result.content.length > 0) {
            const item = result.content[0];
            if (item.type === "text") {
              try {
                return JSON.parse(item.text);
              } catch {
                return item.text;
              }
            }
            return item;
          }
          return result;
        };
      }

      sandbox[serverName] = serverNamespace;
      toolNamespaces[serverName] = true;
    }

    sandbox.__tool_namespaces = Object.keys(toolNamespaces);

    return vm.createContext(sandbox);
  }

  /**
   * Clean up resources.
   * VM executor doesn't need cleanup, but method kept for interface consistency.
   */
  async cleanup(): Promise<void> {
    // VM executor doesn't need cleanup, but method kept for interface consistency
  }
}
