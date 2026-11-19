import type { Tool } from "@modelcontextprotocol/client";
import type { BoxdExecutorOptions, MCPClient } from "../core/node.js";
import { logger } from "../utils/logging.js";
import { BaseCodeExecutor, type ExecutionResult } from "./executor.js";

/** The parts of the boxd SDK client this executor uses. */
interface BoxdExecStream extends AsyncIterable<Uint8Array> {
  readonly stderr: AsyncIterable<Uint8Array>;
  write(data: string): void;
  wait(): Promise<number>;
  close(): void;
}

interface BoxdClient {
  machines: {
    create(params: Record<string, unknown>): Promise<{ id: string }>;
    get(id: string): Promise<{ status: string }>;
    waitUntilReady(id: string): Promise<unknown>;
    start(id: string): Promise<void>;
    streamExec(id: string, params: { command: string }): BoxdExecStream;
    delete(id: string): Promise<void>;
    files: {
      upload(id: string, path: string, source: string): Promise<number>;
    };
  };
}

type BoxdClientClass = new (options: {
  apiKey: string;
  region?: string;
}) => BoxdClient;

interface ToolCallMessage {
  type: "__MCP_TOOL_CALL__";
  id: string;
  server: string;
  tool: string;
  args: unknown;
}

const TOOL_CALL_PREFIX = '{"type":"__MCP_TOOL_CALL__"';
const RESULT_START = "__MCP_RESULT_START__";
const RESULT_END = "__MCP_RESULT_END__";

/**
 * boxd-based code executor using remote microVMs.
 * Executes code in a boxd machine with tool calls proxied back to the host.
 *
 * The machine is created on first use with `isolated: true`, reused for every
 * call, and deleted in `cleanup()`. Tool calls are printed to stdout as JSON
 * lines, run on the host, and their results are written back to the running
 * script's stdin.
 */
export class BoxdCodeExecutor extends BaseCodeExecutor {
  private apiKey: string;
  private options: BoxdExecutorOptions;
  /** The machine this executor created; cleanup() deletes it. */
  private machineId: string | null = null;
  /** Set once the machine has passed waitUntilReady. */
  private readyMachineId: string | null = null;
  private machinePromise: Promise<string> | null = null;
  private boxdClient: Promise<BoxdClient> | null = null;

  constructor(client: MCPClient, options: BoxdExecutorOptions = {}) {
    super(client);
    const apiKey = options.apiKey ?? process.env.BOXD_API_KEY;
    if (!apiKey) {
      throw new Error(
        "The boxd executor requires an API key. " +
          "Pass executorOptions.apiKey or set the BOXD_API_KEY environment variable."
      );
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  /**
   * Lazy load the boxd SDK client.
   * This allows the library to work without the boxd SDK installed.
   */
  private getBoxdClient(): Promise<BoxdClient> {
    if (!this.boxdClient) {
      this.boxdClient = this.loadBoxdClient();
      // Let a later call retry after a failed import
      this.boxdClient.catch(() => {
        this.boxdClient = null;
      });
    }
    return this.boxdClient;
  }

  private async loadBoxdClient(): Promise<BoxdClient> {
    let Boxd: BoxdClientClass;
    try {
      // @ts-ignore - Optional dependency, may not be installed
      const sdk = await import("@boxd-sh/sdk");
      Boxd = sdk.Boxd as BoxdClientClass;
    } catch (error) {
      throw new Error(
        "@boxd-sh/sdk is not installed. " +
          "The boxd code executor requires this optional dependency. " +
          "Install it with: npm install @boxd-sh/sdk, pnpm add @boxd-sh/sdk, or bun add @boxd-sh/sdk"
      );
    }

    return new Boxd({
      apiKey: this.apiKey,
      region: this.options.region,
    });
  }

  /**
   * Get or create the dedicated machine for code execution.
   * Concurrent calls share one machine.
   */
  private async getOrCreateMachine(): Promise<string> {
    if (this.readyMachineId) return this.readyMachineId;
    if (!this.machinePromise) {
      this.machinePromise = this.prepareMachine().finally(() => {
        this.machinePromise = null;
      });
    }
    return this.machinePromise;
  }

  private async prepareMachine(): Promise<string> {
    const boxd = await this.getBoxdClient();
    // Record the id before waiting so cleanup() can delete the machine even
    // if it never becomes ready. A later call waits for it again.
    this.machineId ??= await this.createMachine(boxd);
    await boxd.machines.waitUntilReady(this.machineId);
    this.readyMachineId = this.machineId;
    logger.debug(`boxd machine ${this.machineId} ready for code execution`);
    return this.machineId;
  }

  private async createMachine(boxd: BoxdClient): Promise<string> {
    logger.debug("Starting boxd machine for code execution...");

    const params: Record<string, unknown> = {
      isolated: true,
      org: this.options.org ?? process.env.BOXD_ORG,
      name: this.options.name,
      labels: this.options.labels,
    };
    if (this.options.timeoutMs !== undefined) {
      params.deleteAfter = Math.max(
        1,
        Math.ceil(this.options.timeoutMs / 1000)
      );
    }

    const machine = await boxd.machines.create(params);
    return machine.id;
  }

  /**
   * Generate the shim code that exposes tools to the machine environment.
   * Creates a bridge that sends tool calls to the host over stdout and reads
   * their results from stdin.
   */
  private generateShim(tools: Record<string, Tool[]>): string {
    let shim = `
// MCP Bridge Shim
const __mcpPending = new Map();
let __mcpReader = null;
global.__closeMcpBridge = () => {
    if (__mcpReader) __mcpReader.close();
    process.stdin.destroy();
};
global.__callMcpTool = async (server, tool, args) => {
    if (!__mcpReader) {
        __mcpReader = require('readline').createInterface({ input: process.stdin });
        __mcpReader.on('line', (line) => {
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                return;
            }
            const resolve = __mcpPending.get(message.id);
            if (resolve) {
                __mcpPending.delete(message.id);
                resolve(message);
            }
        });
    }

    const id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            __mcpPending.delete(id);
            reject(new Error('Tool execution timed out'));
        }, 30000);
        __mcpPending.set(id, (message) => {
            clearTimeout(timer);
            resolve(message);
        });
    });

    console.log(JSON.stringify({
        type: '__MCP_TOOL_CALL__',
        id,
        server,
        tool,
        args
    }));

    const result = await response;
    if (result.error) {
        throw new Error(result.error);
    }
    return result.data;
};

// Global search_tools helper
global.search_tools = async (query, detailLevel = 'full') => {
    const allTools = ${JSON.stringify(
      Object.entries(tools).flatMap(([server, serverTools]) =>
        serverTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          server,
          input_schema: tool.inputSchema,
        }))
      )
    )};

    const filtered = allTools.filter(tool => {
        if (!query) return true;
        const q = query.toLowerCase();
        return tool.name.toLowerCase().includes(q) ||
               (tool.description && tool.description.toLowerCase().includes(q));
    });

    if (detailLevel === 'names') {
        return filtered.map(t => ({ name: t.name, server: t.server }));
    } else if (detailLevel === 'descriptions') {
        return filtered.map(t => ({ name: t.name, server: t.server, description: t.description }));
    }
    return filtered;
};
`;

    // Generate namespaces for each server
    for (const [serverName, serverTools] of Object.entries(tools)) {
      // Skip empty tool lists
      if (!serverTools || serverTools.length === 0) continue;

      // Create safe server name for JS identifier (replace hyphens etc)
      const safeServerName = serverName.replace(/[^a-zA-Z0-9_]/g, "_");

      // Serialize names so quotes and other special characters stay valid in the generated code
      const escapedServerName = JSON.stringify(serverName);
      const escapedSafeServerName = JSON.stringify(safeServerName);

      shim += `
global[${escapedServerName}] = {`;

      for (const tool of serverTools) {
        const escapedToolName = JSON.stringify(tool.name);
        shim += `
    [${escapedToolName}]: async (args) => await global.__callMcpTool(${escapedServerName}, ${escapedToolName}, args),`;
      }

      shim += `
};
`;

      if (safeServerName !== serverName) {
        shim += `
// Also expose as safe name if different
global[${escapedSafeServerName}] = global[${escapedServerName}];
`;
      }
    }

    return shim;
  }

  /**
   * Build the tool catalog for the shim.
   * Returns a map of server names to their available tools.
   */
  private buildToolCatalog(): Record<string, Tool[]> {
    const catalog: Record<string, Tool[]> = {};
    const namespaces = this.getToolNamespaces();

    for (const { serverName, tools } of namespaces) {
      catalog[serverName] = tools;
    }

    return catalog;
  }

  /**
   * Run one tool call from the machine on the host and return the line to
   * write back to the script's stdin.
   */
  private async runToolCall(call: ToolCallMessage): Promise<string> {
    try {
      logger.debug(`[boxd Bridge] Calling tool ${call.server}.${call.tool}`);

      const activeSessions = this.client.getAllActiveSessions();
      const session = activeSessions[call.server];

      if (!session) {
        throw new Error(`Server ${call.server} not found`);
      }

      const toolResult = await session.connector.callTool(
        call.tool,
        call.args as Record<string, unknown>
      );

      // Extract result from MCP response
      let extractedResult: unknown = toolResult;
      if (toolResult.content && toolResult.content.length > 0) {
        const item = toolResult.content[0];
        if (item.type === "text") {
          try {
            extractedResult = JSON.parse(item.text);
          } catch {
            extractedResult = item.text;
          }
        } else {
          extractedResult = item;
        }
      }

      return JSON.stringify({ id: call.id, data: extractedResult }) + "\n";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[boxd Bridge] Tool execution failed: ${message}`);
      return JSON.stringify({ id: call.id, error: message }) + "\n";
    }
  }

  /**
   * Upload the script and return the machine it was uploaded to. A stopped
   * machine is started first. A machine that no longer exists (for example
   * deleted by `timeoutMs`) is replaced with a new one.
   */
  private async uploadScript(
    boxd: BoxdClient,
    filename: string,
    contents: string
  ): Promise<string> {
    let machineId = await this.getOrCreateMachine();
    try {
      await boxd.machines.files.upload(machineId, filename, contents);
      return machineId;
    } catch (error) {
      const name = (error as Error | undefined)?.name;
      if (name === "NotFoundError") {
        logger.debug(`boxd machine ${machineId} is gone, creating a new one`);
        if (this.machineId === machineId) {
          this.machineId = null;
          this.readyMachineId = null;
        }
        machineId = await this.getOrCreateMachine();
      } else if (
        name === "ConflictError" &&
        (await boxd.machines.get(machineId)).status === "stopped"
      ) {
        logger.debug(`Starting stopped boxd machine ${machineId}...`);
        await boxd.machines.start(machineId);
        await boxd.machines.waitUntilReady(machineId);
      } else {
        throw error;
      }
      await boxd.machines.files.upload(machineId, filename, contents);
      return machineId;
    }
  }

  /**
   * Execute JavaScript/TypeScript code in a boxd machine with MCP tool access.
   * Tool calls are proxied back to the host via the bridge pattern.
   *
   * @param code - Code to execute
   * @param timeout - Execution timeout in milliseconds (default: 30000)
   */
  async execute(code: string, timeout = 30000): Promise<ExecutionResult> {
    const startTime = Date.now();
    let result: unknown = null;
    let error: string | null = null;
    let logs: string[] = [];

    try {
      // Ensure all servers are connected
      await this.ensureServersConnected();

      const boxd = await this.getBoxdClient();

      // Build tool catalog and generate shim
      const toolCatalog = this.buildToolCatalog();
      const shim = this.generateShim(toolCatalog);

      // Write code to a file, wrapping it to capture the return value
      // Inject shim before user code
      const wrappedCode = `
${shim}

(async () => {
    try {
        const func = async () => {
            ${code}
        };
        const result = await func();
        console.log('${RESULT_START}');
        console.log(JSON.stringify(result));
        console.log('${RESULT_END}');
        global.__closeMcpBridge();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
`;

      const filename = `/var/tmp/mcp_use_exec_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 8)}.js`;
      const machineId = await this.uploadScript(boxd, filename, wrappedCode);

      // Execute the file
      const stream = boxd.machines.streamExec(machineId, {
        command: `node ${filename}; status=$?; rm -f ${filename}; exit $status`,
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stream.close();
          reject(new Error("Script execution timed out"));
        }, timeout);
      });

      const decoder = new TextDecoder();
      let stdout = "";
      let stderr = "";
      let pendingLine = "";

      const stderrDone = (async () => {
        const stderrDecoder = new TextDecoder();
        try {
          for await (const chunk of stream.stderr) {
            stderr += stderrDecoder.decode(chunk, { stream: true });
          }
        } catch {
          // The stdout loop below reports stream errors
        }
        stderr += stderrDecoder.decode();
      })();

      const handleLine = (line: string) => {
        if (!line.trim().startsWith(TOOL_CALL_PREFIX)) return;
        let call: ToolCallMessage;
        try {
          call = JSON.parse(line);
        } catch {
          return;
        }
        if (call.type !== "__MCP_TOOL_CALL__") return;
        // Not awaited: the script waits for the reply, and a reply that
        // arrives after the script has exited is dropped.
        void this.runToolCall(call).then((reply) => {
          try {
            stream.write(reply);
          } catch (err) {
            logger.debug(`[boxd Bridge] Could not send tool result: ${err}`);
          }
        });
      };

      const run = async (): Promise<number> => {
        for await (const chunk of stream) {
          const text = decoder.decode(chunk, { stream: true });
          stdout += text;
          // Output arrives in chunks, so only act on complete lines
          pendingLine += text;
          let newline = pendingLine.indexOf("\n");
          while (newline !== -1) {
            handleLine(pendingLine.slice(0, newline));
            pendingLine = pendingLine.slice(newline + 1);
            newline = pendingLine.indexOf("\n");
          }
        }
        stdout += decoder.decode();
        const code = await stream.wait();
        await stderrDone;
        return code;
      };

      let exitCode: number;
      try {
        exitCode = await Promise.race([run(), timedOut]);
      } finally {
        clearTimeout(timer);
      }

      logs = [stdout, stderr].filter(Boolean);

      if (exitCode !== 0) {
        error = stderr || "Execution failed";
      } else {
        const startIndex = stdout.indexOf(RESULT_START);
        const endIndex = stdout.indexOf(RESULT_END);

        if (startIndex !== -1 && endIndex !== -1) {
          const jsonStr = stdout
            .substring(startIndex + RESULT_START.length, endIndex)
            .trim();
          try {
            result = JSON.parse(jsonStr);
          } catch (e) {
            result = jsonStr;
          }

          // Clean logs - remove result block and tool calls
          logs = logs.map((log) => {
            const cleaned = log.replace(
              new RegExp(RESULT_START + "[\\s\\S]*?" + RESULT_END),
              "[Result captured]"
            );
            // Also hide the raw tool call JSON lines from user logs to keep it clean
            return cleaned
              .split("\n")
              .filter((l) => !l.includes("__MCP_TOOL_CALL__"))
              .join("\n");
          });
        }
      }
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);

      // Check for timeout
      if (error.includes("timeout") || error.includes("timed out")) {
        error = "Script execution timed out";
      }
    }

    return {
      result,
      logs,
      error,
      execution_time: (Date.now() - startTime) / 1000,
    };
  }

  /**
   * Delete the boxd machine.
   * Should be called when the executor is no longer needed.
   */
  async cleanup(): Promise<void> {
    if (this.machinePromise) {
      await this.machinePromise.catch(() => undefined);
    }
    if (this.machineId) {
      const machineId = this.machineId;
      try {
        const boxd = await this.getBoxdClient();
        await boxd.machines.delete(machineId);
        logger.debug(`boxd code execution machine ${machineId} deleted`);
      } catch (error) {
        if ((error as Error | undefined)?.name !== "NotFoundError") {
          logger.error("Failed to delete boxd code execution machine:", error);
        }
      }
      this.machineId = null;
      this.readyMachineId = null;
    }
  }
}
