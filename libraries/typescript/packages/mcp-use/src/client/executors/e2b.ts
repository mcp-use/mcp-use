import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { E2BExecutorOptions, MCPClient } from "../../client.js";
import { logger } from "../../logging.js";
import { BaseCodeExecutor, type ExecutionResult } from "./base.js";

// Dynamic import type for E2B Sandbox
type Sandbox = any;

/**
 * E2B-based code executor using remote sandboxes.
 * Executes code in an E2B sandbox with tool calls proxied back to the host.
 */
export class E2BCodeExecutor extends BaseCodeExecutor {
  private e2bApiKey: string;
  private codeExecSandbox: Sandbox | null = null;
  private SandboxClass: any = null;
  private timeoutMs: number;

  constructor(client: MCPClient, options: E2BExecutorOptions) {
    super(client);
    this.e2bApiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 300000; // Default: 5 minutes
  }

  /**
   * Lazy load E2B Sandbox class.
   * This allows the library to work without E2B installed.
   */
  private async ensureSandboxClass(): Promise<void> {
    if (this.SandboxClass) return;

    try {
      // @ts-ignore - Optional dependency, may not be installed
      const e2b = await import("@e2b/code-interpreter");
      this.SandboxClass = e2b.Sandbox;
    } catch (error) {
      throw new Error(
        "@e2b/code-interpreter is not installed. " +
          "The E2B code executor requires this optional dependency. " +
          "Install it with: yarn add @e2b/code-interpreter"
      );
    }
  }

  /**
   * Get or create a dedicated sandbox for code execution.
   */
  private async getOrCreateCodeExecSandbox(): Promise<Sandbox> {
    if (this.codeExecSandbox) return this.codeExecSandbox;

    await this.ensureSandboxClass();
    logger.debug("Starting E2B sandbox for code execution...");

    this.codeExecSandbox = await this.SandboxClass.create("base", {
      apiKey: this.e2bApiKey,
      timeoutMs: this.timeoutMs,
    });

    return this.codeExecSandbox;
  }

  /**
   * Generate the shim code that exposes tools to the sandbox environment.
   * Creates a bridge that intercepts tool calls and sends them back to host.
   */
  private generateShim(tools: Record<string, Tool[]>): string {
    let shim = `
// MCP Bridge Shim
global.__callMcpTool = async (server, tool, args) => {
    const id = Math.random().toString(36).substring(7);
    console.log(JSON.stringify({
        type: '__MCP_TOOL_CALL__',
        id,
        server,
        tool,
        args
    }));
    
    const resultPath = \`/tmp/mcp_result_\${id}.json\`;
    const fs = require('fs');
    
    // Poll for result file
    let attempts = 0;
    while (attempts < 300) { // 30 seconds timeout
        if (fs.existsSync(resultPath)) {
            const content = fs.readFileSync(resultPath, 'utf8');
            const result = JSON.parse(content);
            fs.unlinkSync(resultPath); // Clean up
            
            if (result.error) {
                throw new Error(result.error);
            }
            return result.data;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    throw new Error('Tool execution timed out');
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

      shim += `
global['${serverName}'] = {`;

      for (const tool of serverTools) {
        shim += `
    '${tool.name}': async (args) => await global.__callMcpTool('${serverName}', '${tool.name}', args),`;
      }

      shim += `
};

// Also expose as safe name if different
if ('${safeServerName}' !== '${serverName}') {
    global['${safeServerName}'] = global['${serverName}'];
}
`;
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
   * Execute JavaScript/TypeScript code in an E2B sandbox with MCP tool access.
   * Tool calls are proxied back to the host via the bridge pattern.
   *
   * @param code - Code to execute
   * @param timeout - Execution timeout in milliseconds (default: 30000)
   */
  async execute(code: string, timeout = 30000): Promise<ExecutionResult> {
    const startTime = Date.now();
    let result: any = null;
    let error: string | null = null;
    let logs: string[] = [];

    try {
      // Ensure all servers are connected
      await this.ensureServersConnected();

      // Get or create sandbox
      const sandbox = await this.getOrCreateCodeExecSandbox();

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
        console.log('__MCP_RESULT_START__');
        console.log(JSON.stringify(result));
        console.log('__MCP_RESULT_END__');
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
`;

      const filename = `exec_${Date.now()}.js`;
      await sandbox.files.write(filename, wrappedCode);

      // Execute the file
      const execution = await sandbox.commands.run(`node ${filename}`, {
        timeoutMs: timeout,
        onStdout: async (data: string) => {
          // Check for tool calls
          try {
            const lines = data.split("\n");
            for (const line of lines) {
              if (line.trim().startsWith('{"type":"__MCP_TOOL_CALL__"')) {
                const call = JSON.parse(line);
                if (call.type === "__MCP_TOOL_CALL__") {
                  // Execute tool on host
                  try {
                    logger.debug(
                      `[E2B Bridge] Calling tool ${call.server}.${call.tool}`
                    );

                    // Get the session and call the tool
                    const activeSessions = this.client.getAllActiveSessions();
                    const session = activeSessions[call.server];

                    if (!session) {
                      throw new Error(`Server ${call.server} not found`);
                    }

                    const toolResult = await session.connector.callTool(
                      call.tool,
                      call.args
                    );

                    // Extract result from MCP response
                    let extractedResult: any = toolResult;
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

                    // Write result back to sandbox
                    const resultPath = `/tmp/mcp_result_${call.id}.json`;
                    await sandbox.files.write(
                      resultPath,
                      JSON.stringify({ data: extractedResult })
                    );
                  } catch (err: any) {
                    logger.error(
                      `[E2B Bridge] Tool execution failed: ${err.message}`
                    );
                    // Write error back to sandbox
                    const resultPath = `/tmp/mcp_result_${call.id}.json`;
                    await sandbox.files.write(
                      resultPath,
                      JSON.stringify({
                        error: err.message || String(err),
                      })
                    );
                  }
                }
              }
            }
          } catch (e) {
            // Ignore parsing errors for non-JSON lines
          }
        },
      });

      logs = [execution.stdout, execution.stderr].filter(Boolean);

      if (execution.exitCode !== 0) {
        error = execution.stderr || "Execution failed";
      } else {
        const stdout = execution.stdout;
        const startMarker = "__MCP_RESULT_START__";
        const endMarker = "__MCP_RESULT_END__";

        const startIndex = stdout.indexOf(startMarker);
        const endIndex = stdout.indexOf(endMarker);

        if (startIndex !== -1 && endIndex !== -1) {
          const jsonStr = stdout
            .substring(startIndex + startMarker.length, endIndex)
            .trim();
          try {
            result = JSON.parse(jsonStr);
          } catch (e) {
            result = jsonStr;
          }

          // Clean logs - remove result block and tool calls
          logs = logs.map((log) => {
            let cleaned = log.replace(
              new RegExp(startMarker + "[\\s\\S]*?" + endMarker),
              "[Result captured]"
            );
            // Also hide the raw tool call JSON lines from user logs to keep it clean
            cleaned = cleaned
              .split("\n")
              .filter((l) => !l.includes("__MCP_TOOL_CALL__"))
              .join("\n");
            return cleaned;
          });
        }
      }
    } catch (e: any) {
      error = e.message || String(e);

      // Check for timeout
      if (error && (error.includes("timeout") || error.includes("timed out"))) {
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
   * Clean up the E2B sandbox.
   * Should be called when the executor is no longer needed.
   */
  async cleanup(): Promise<void> {
    if (this.codeExecSandbox) {
      try {
        await this.codeExecSandbox.kill();
        this.codeExecSandbox = null;
        logger.debug("E2B code execution sandbox stopped");
      } catch (error) {
        logger.error("Failed to stop E2B code execution sandbox:", error);
      }
    }
  }
}
