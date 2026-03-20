import chalk from "chalk";
import { Command } from "commander";
import type { MCPSession } from "mcp-use/client";
import { MCPClient } from "mcp-use/client";
import { getPackageVersion } from "mcp-use/server";
import { createInterface } from "node:readline";
import {
  formatError,
  formatHeader,
  formatInfo,
  formatJson,
  formatKeyValue,
  formatPromptMessages,
  formatResourceContent,
  formatSchema,
  formatSuccess,
  formatTable,
  formatToolCall,
  formatWarning,
} from "../utils/format.js";
import {
  getActiveSession,
  getSession,
  listAllSessions,
  saveSession,
  setActiveSession,
  updateSessionInfo,
} from "../utils/session-storage.js";

// In-memory session map
const activeSessions = new Map<
  string,
  { client: MCPClient; session: MCPSession }
>();

/**
 * Get or restore a session by name
 */
async function getOrRestoreSession(
  sessionName: string | null
): Promise<{ name: string; session: MCPSession } | null> {
  // If no session name provided, use active session
  if (!sessionName) {
    const active = await getActiveSession();
    if (!active) {
      console.error(
        formatError("No active session. Connect to a server first.")
      );
      console.error(
        formatInfo("Use: npx mcp-use client connect <url> --name <name>")
      );
      return null;
    }
    sessionName = active.name;
  }

  // Check if session is already connected in memory
  if (activeSessions.has(sessionName)) {
    const { session } = activeSessions.get(sessionName)!;
    return { name: sessionName, session };
  }

  // Try to restore from storage
  const config = await getSession(sessionName);
  if (!config) {
    console.error(formatError(`Session '${sessionName}' not found`));
    return null;
  }

  // Reconnect
  try {
    const client = new MCPClient();
    const cliClientInfo = getCliClientInfo();

    if (config.type === "http") {
      client.addServer(sessionName, {
        url: config.url!,
        headers: config.authToken
          ? { Authorization: `Bearer ${config.authToken}` }
          : undefined,
        clientInfo: cliClientInfo,
      });
    } else if (config.type === "stdio") {
      client.addServer(sessionName, {
        command: config.command!,
        args: config.args || [],
        env: config.env,
        clientInfo: cliClientInfo,
      });
    } else {
      console.error(formatError(`Unknown session type: ${config.type}`));
      return null;
    }

    const session = await client.createSession(sessionName);
    activeSessions.set(sessionName, { client, session });

    console.error(formatInfo(`Reconnected to session '${sessionName}'`));
    return { name: sessionName, session };
  } catch (error: any) {
    console.error(formatError(`Failed to restore session: ${error.message}`));
    return null;
  }
}

/**
 * Connect command
 */
/**
 * Default clientInfo for mcp-use CLI
 */
function getCliClientInfo() {
  return {
    name: "mcp-use CLI",
    title: "mcp-use CLI",
    version: getPackageVersion(),
    description: "mcp-use CLI - Command-line interface for MCP servers",
    icons: [
      {
        src: "https://manufact.com/logo.png",
      },
    ],
    websiteUrl: "https://manufact.com",
  };
}

export async function connectCommand(
  urlOrCommand: string,
  options: {
    name?: string;
    stdio?: boolean;
    auth?: string;
  }
): Promise<void> {
  try {
    const sessionName = options.name || `session-${Date.now()}`;

    const client = new MCPClient();
    let session: MCPSession;
    const cliClientInfo = getCliClientInfo();

    if (options.stdio) {
      // Parse stdio command
      const parts = urlOrCommand.split(" ");
      const command = parts[0];
      const args = parts.slice(1);

      console.error(
        formatInfo(`Connecting to stdio server: ${command} ${args.join(" ")}`)
      );

      client.addServer(sessionName, {
        command,
        args,
        clientInfo: cliClientInfo,
      });

      session = await client.createSession(sessionName);

      // Save session config
      await saveSession(sessionName, {
        type: "stdio",
        command,
        args,
        lastUsed: new Date().toISOString(),
      });
    } else {
      // HTTP connection
      console.error(formatInfo(`Connecting to ${urlOrCommand}...`));

      client.addServer(sessionName, {
        url: urlOrCommand,
        headers: options.auth
          ? { Authorization: `Bearer ${options.auth}` }
          : undefined,
        clientInfo: cliClientInfo,
      });

      session = await client.createSession(sessionName);

      // Save session config
      await saveSession(sessionName, {
        type: "http",
        url: urlOrCommand,
        authToken: options.auth,
        lastUsed: new Date().toISOString(),
      });
    }

    // Store in memory
    activeSessions.set(sessionName, { client, session });

    // Update session info
    const serverInfo = session.serverInfo;
    const capabilities = session.serverCapabilities;

    if (serverInfo) {
      await updateSessionInfo(sessionName, serverInfo, capabilities);
    }

    // Display connection info
    console.log(formatSuccess(`Connected to ${sessionName}`));

    if (serverInfo) {
      console.log("");
      console.log(formatHeader("Server Information:"));
      console.log(
        formatKeyValue({
          Name: serverInfo.name,
          Version: serverInfo.version || "unknown",
        })
      );
    }

    if (capabilities) {
      console.log("");
      console.log(formatHeader("Capabilities:"));
      const caps = Object.keys(capabilities).join(", ");
      console.log(`  ${caps || "none"}`);
    }

    // Count available resources
    const tools = session.tools;
    console.log("");
    console.log(
      formatInfo(
        `Available: ${tools.length} tool${tools.length !== 1 ? "s" : ""}`
      )
    );
  } catch (error: any) {
    console.error(formatError(`Connection failed: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Disconnect command
 */
export async function disconnectCommand(
  sessionName?: string,
  options?: { all?: boolean }
): Promise<void> {
  try {
    if (options?.all) {
      // Disconnect all sessions
      for (const [name, { client }] of activeSessions.entries()) {
        await client.closeAllSessions();
        activeSessions.delete(name);
        console.log(formatSuccess(`Disconnected from ${name}`));
      }
      return;
    }

    if (!sessionName) {
      const active = await getActiveSession();
      if (!active) {
        console.error(formatError("No active session to disconnect"));
        return;
      }
      sessionName = active.name;
    }

    const sessionData = activeSessions.get(sessionName);
    if (sessionData) {
      await sessionData.client.closeAllSessions();
      activeSessions.delete(sessionName);
      console.log(formatSuccess(`Disconnected from ${sessionName}`));
    } else {
      console.log(formatInfo(`Session '${sessionName}' is not connected`));
    }
  } catch (error: any) {
    console.error(formatError(`Failed to disconnect: ${error.message}`));
    process.exit(1);
  }
}

/**
 * List sessions command
 */
export async function listSessionsCommand(): Promise<void> {
  try {
    const sessions = await listAllSessions();

    if (sessions.length === 0) {
      console.log(formatInfo("No saved sessions"));
      console.log(
        formatInfo("Connect to a server with: npx mcp-use client connect <url>")
      );
      return;
    }

    console.log(formatHeader("Saved Sessions:"));
    console.log("");

    const tableData = sessions.map((s) => ({
      name: s.isActive ? chalk.green.bold(`${s.name} *`) : s.name,
      type: s.config.type,
      target:
        s.config.type === "http"
          ? s.config.url || ""
          : `${s.config.command} ${(s.config.args || []).join(" ")}`,
      server: s.config.serverInfo?.name || "unknown",
      status: activeSessions.has(s.name)
        ? chalk.green("connected")
        : chalk.gray("disconnected"),
    }));

    console.log(
      formatTable(tableData, [
        { key: "name", header: "Name" },
        { key: "type", header: "Type" },
        { key: "target", header: "Target", width: 40 },
        { key: "server", header: "Server" },
        { key: "status", header: "Status" },
      ])
    );

    console.log("");
    console.log(chalk.gray("* = active session"));
  } catch (error: any) {
    console.error(formatError(`Failed to list sessions: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Switch session command
 */
export async function switchSessionCommand(name: string): Promise<void> {
  try {
    await setActiveSession(name);
    console.log(formatSuccess(`Switched to session '${name}'`));
  } catch (error: any) {
    console.error(formatError(`Failed to switch session: ${error.message}`));
    process.exit(1);
  }
}

/**
 * List tools command
 */
export async function listToolsCommand(options: {
  session?: string;
  json?: boolean;
}): Promise<void> {
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) return;

    const { session } = result;
    const tools = await session.listTools();

    if (options.json) {
      console.log(formatJson(tools));
      return;
    }

    if (tools.length === 0) {
      console.log(formatInfo("No tools available"));
      return;
    }

    console.log(formatHeader(`Available Tools (${tools.length}):`));
    console.log("");

    const tableData = tools.map((tool) => ({
      name: chalk.bold(tool.name),
      description: tool.description || chalk.gray("No description"),
    }));

    console.log(
      formatTable(tableData, [
        { key: "name", header: "Tool", width: 25 },
        { key: "description", header: "Description", width: 50 },
      ])
    );
  } catch (error: any) {
    console.error(formatError(`Failed to list tools: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Describe tool command
 */
export async function describeToolCommand(
  toolName: string,
  options: { session?: string }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) return;

    const { session } = result;
    const tools = session.tools;
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      console.error(formatError(`Tool '${toolName}' not found`));
      console.log("");
      console.log(formatInfo("Available tools:"));
      tools.forEach((t) => console.log(`  • ${t.name}`));
      return;
    }

    console.log(formatHeader(`Tool: ${tool.name}`));
    console.log("");

    if (tool.description) {
      console.log(tool.description);
      console.log("");
    }

    if (tool.inputSchema) {
      console.log(formatHeader("Input Schema:"));
      console.log(formatSchema(tool.inputSchema));
    }
  } catch (error: any) {
    console.error(formatError(`Failed to describe tool: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Call tool command
 */
export async function callToolCommand(
  toolName: string,
  argsJson?: string,
  options?: { session?: string; timeout?: number; json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(options?.session || null);
    if (!result) return;

    const { session } = result;

    // Parse arguments
    let args: Record<string, any> = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch (error) {
        console.error(formatError("Invalid JSON arguments"));
        return;
      }
    } else {
      // Check if tool requires arguments
      const tools = session.tools;
      const tool = tools.find((t) => t.name === toolName);

      if (tool?.inputSchema?.required && tool.inputSchema.required.length > 0) {
        console.error(
          formatError(
            "This tool requires arguments. Provide them as a JSON string."
          )
        );
        console.log("");
        console.log(formatInfo("Example:"));
        console.log(
          `  npx mcp-use client tools call ${toolName} '{"param": "value"}'`
        );
        console.log("");
        console.log(formatInfo("Tool schema:"));
        console.log(formatSchema(tool.inputSchema));
        return;
      }
    }

    // Call the tool
    console.error(formatInfo(`Calling tool '${toolName}'...`));
    const callResult = await session.callTool(toolName, args, {
      timeout: options?.timeout,
    });

    if (options?.json) {
      console.log(formatJson(callResult));
    } else {
      console.log(formatToolCall(callResult));
    }
  } catch (error: any) {
    console.error(formatError(`Failed to call tool: ${error.message}`));
    process.exit(1);
  }
}

/**
 * List resources command
 */
export async function listResourcesCommand(options: {
  session?: string;
  json?: boolean;
}): Promise<void> {
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) return;

    const { session } = result;
    const resourcesResult = await session.listAllResources();
    const resources = resourcesResult.resources;

    if (options.json) {
      console.log(formatJson(resources));
      return;
    }

    if (resources.length === 0) {
      console.log(formatInfo("No resources available"));
      return;
    }

    console.log(formatHeader(`Available Resources (${resources.length}):`));
    console.log("");

    const tableData = resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name || chalk.gray("(no name)"),
      type: resource.mimeType || chalk.gray("unknown"),
    }));

    console.log(
      formatTable(tableData, [
        { key: "uri", header: "URI", width: 40 },
        { key: "name", header: "Name", width: 20 },
        { key: "type", header: "Type", width: 15 },
      ])
    );
  } catch (error: any) {
    console.error(formatError(`Failed to list resources: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Read resource command
 */
export async function readResourceCommand(
  uri: string,
  options: { session?: string; json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) return;

    const { session } = result;

    console.error(formatInfo(`Reading resource: ${uri}`));
    const resource = await session.readResource(uri);

    if (options.json) {
      console.log(formatJson(resource));
    } else {
      console.log(formatResourceContent(resource));
    }
  } catch (error: any) {
    console.error(formatError(`Failed to read resource: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Subscribe to resource command
 */
export async function subscribeResourceCommand(
  uri: string,
  options: { session?: string }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) return;

    const { session } = result;

    await session.subscribeToResource(uri);
    console.log(formatSuccess(`Subscribed to resource: ${uri}`));

    // Set up notification handler
    session.on("notification", async (notification) => {
      if (notification.method === "notifications/resources/updated") {
        console.log("");
        console.log(formatInfo("Resource updated:"));
        console.log(formatJson(notification.params));
      }
    });

    console.log(formatInfo("Listening for updates... (Press Ctrl+C to stop)"));

    // Keep process alive
    await new Promise(() => {});
  } catch (error: any) {
    console.error(
      formatError(`Failed to subscribe to resource: ${error.message}`)
    );
    process.exit(1);
  }
}

/**
 * Unsubscribe from resource command
 */
export async function unsubscribeResourceCommand(
  uri: string,
  options: { session?: string }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) return;

    const { session } = result;

    await session.unsubscribeFromResource(uri);
    console.log(formatSuccess(`Unsubscribed from resource: ${uri}`));
  } catch (error: any) {
    console.error(
      formatError(`Failed to unsubscribe from resource: ${error.message}`)
    );
    process.exit(1);
  }
}

/**
 * List prompts command
 */
export async function listPromptsCommand(options: {
  session?: string;
  json?: boolean;
}): Promise<void> {
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) return;

    const { session } = result;
    const promptsResult = await session.listPrompts();
    const prompts = promptsResult.prompts;

    if (options.json) {
      console.log(formatJson(prompts));
      return;
    }

    if (prompts.length === 0) {
      console.log(formatInfo("No prompts available"));
      return;
    }

    console.log(formatHeader(`Available Prompts (${prompts.length}):`));
    console.log("");

    const tableData = prompts.map((prompt) => ({
      name: chalk.bold(prompt.name),
      description: prompt.description || chalk.gray("No description"),
    }));

    console.log(
      formatTable(tableData, [
        { key: "name", header: "Prompt", width: 25 },
        { key: "description", header: "Description", width: 50 },
      ])
    );
  } catch (error: any) {
    console.error(formatError(`Failed to list prompts: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Get prompt command
 */
export async function getPromptCommand(
  promptName: string,
  argsJson?: string,
  options?: { session?: string; json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(options?.session || null);
    if (!result) return;

    const { session } = result;

    // Parse arguments
    let args: Record<string, any> = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch (error) {
        console.error(formatError("Invalid JSON arguments"));
        return;
      }
    }

    console.error(formatInfo(`Getting prompt '${promptName}'...`));
    const prompt = await session.getPrompt(promptName, args);

    if (options?.json) {
      console.log(formatJson(prompt));
    } else {
      console.log(formatHeader(`Prompt: ${promptName}`));
      console.log("");

      if (prompt.description) {
        console.log(prompt.description);
        console.log("");
      }

      if (prompt.messages) {
        console.log(formatHeader("Messages:"));
        console.log("");
        console.log(formatPromptMessages(prompt.messages));
      }
    }
  } catch (error: any) {
    console.error(formatError(`Failed to get prompt: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Interactive mode command
 */
export async function interactiveCommand(options: {
  session?: string;
}): Promise<void> {
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) return;

    const { name: sessionName, session } = result;

    console.log(formatHeader("MCP Interactive Mode"));
    console.log("");
    console.log(formatInfo(`Connected to: ${sessionName}`));
    console.log("");
    console.log(chalk.gray("Commands:"));
    console.log(chalk.gray("  tools list              - List available tools"));
    console.log(
      chalk.gray(
        "  tools call <name>       - Call a tool (will prompt for args)"
      )
    );
    console.log(chalk.gray("  tools describe <name>   - Show tool details"));
    console.log(
      chalk.gray("  resources list          - List available resources")
    );
    console.log(chalk.gray("  resources read <uri>    - Read a resource"));
    console.log(
      chalk.gray("  prompts list            - List available prompts")
    );
    console.log(chalk.gray("  prompts get <name>      - Get a prompt"));
    console.log(chalk.gray("  sessions list           - List all sessions"));
    console.log(
      chalk.gray("  sessions switch <name>  - Switch to another session")
    );
    console.log(
      chalk.gray("  exit, quit              - Exit interactive mode")
    );
    console.log("");

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("mcp> "),
    });

    rl.prompt();

    rl.on("line", async (line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        console.log(formatInfo("Goodbye!"));
        rl.close();
        process.exit(0);
      }

      const parts = trimmed.split(" ");
      const scope = parts[0];
      const command = parts[1];
      const arg = parts[2];

      try {
        if (scope === "tools") {
          if (command === "list") {
            const tools = await session.listTools();
            console.log(
              formatInfo(
                `Available tools: ${tools.map((t) => t.name).join(", ")}`
              )
            );
          } else if (command === "call" && arg) {
            // Prompt for arguments
            rl.question(
              "Arguments (JSON, or press Enter for none): ",
              async (argsInput) => {
                try {
                  const args = argsInput.trim() ? JSON.parse(argsInput) : {};
                  const result = await session.callTool(arg, args);
                  console.log(formatToolCall(result));
                } catch (error: any) {
                  console.error(formatError(error.message));
                }
                rl.prompt();
              }
            );
            return;
          } else if (command === "describe" && arg) {
            const tools = session.tools;
            const tool = tools.find((t) => t.name === arg);
            if (tool) {
              console.log(formatHeader(`Tool: ${tool.name}`));
              if (tool.description) console.log(tool.description);
              if (tool.inputSchema) {
                console.log("");
                console.log(formatSchema(tool.inputSchema));
              }
            } else {
              console.error(formatError(`Tool '${arg}' not found`));
            }
          } else {
            console.error(
              formatError(
                "Invalid command. Try: tools list, tools call <name>, tools describe <name>"
              )
            );
          }
        } else if (scope === "resources") {
          if (command === "list") {
            const result = await session.listAllResources();
            const resources = result.resources;
            console.log(
              formatInfo(
                `Available resources: ${resources.map((r) => r.uri).join(", ")}`
              )
            );
          } else if (command === "read" && arg) {
            const resource = await session.readResource(arg);
            console.log(formatResourceContent(resource));
          } else {
            console.error(
              formatError(
                "Invalid command. Try: resources list, resources read <uri>"
              )
            );
          }
        } else if (scope === "prompts") {
          if (command === "list") {
            const result = await session.listPrompts();
            const prompts = result.prompts;
            console.log(
              formatInfo(
                `Available prompts: ${prompts.map((p) => p.name).join(", ")}`
              )
            );
          } else if (command === "get" && arg) {
            rl.question(
              "Arguments (JSON, or press Enter for none): ",
              async (argsInput) => {
                try {
                  const args = argsInput.trim() ? JSON.parse(argsInput) : {};
                  const prompt = await session.getPrompt(arg, args);
                  console.log(formatPromptMessages(prompt.messages));
                } catch (error: any) {
                  console.error(formatError(error.message));
                }
                rl.prompt();
              }
            );
            return;
          } else {
            console.error(
              formatError(
                "Invalid command. Try: prompts list, prompts get <name>"
              )
            );
          }
        } else if (scope === "sessions") {
          if (command === "list") {
            await listSessionsCommand();
          } else if (command === "switch" && arg) {
            console.log(
              formatWarning(
                "Session switching in interactive mode will be available in a future version"
              )
            );
          } else {
            console.error(formatError("Invalid command. Try: sessions list"));
          }
        } else {
          console.error(
            formatError(
              "Unknown command. Type a valid scope: tools, resources, prompts, sessions"
            )
          );
        }
      } catch (error: any) {
        console.error(formatError(error.message));
      }

      rl.prompt();
    });

    rl.on("close", () => {
      console.log("");
      console.log(formatInfo("Goodbye!"));
      process.exit(0);
    });
  } catch (error: any) {
    console.error(
      formatError(`Failed to start interactive mode: ${error.message}`)
    );
    process.exit(1);
  }
}

/**
 * Create the client command group
 */
export function createClientCommand(): Command {
  const clientCommand = new Command("client").description(
    "Interactive MCP client for terminal usage"
  );

  // Connection commands
  clientCommand
    .command("connect <url>")
    .description("Connect to an MCP server")
    .option("--name <name>", "Session name")
    .option("--stdio", "Use stdio connector instead of HTTP")
    .option("--auth <token>", "Authentication token")
    .action(connectCommand);

  clientCommand
    .command("disconnect [session]")
    .description("Disconnect from a session")
    .option("--all", "Disconnect all sessions")
    .action(disconnectCommand);

  // Sessions scope
  const sessionsCommand = new Command("sessions").description(
    "Manage CLI sessions"
  );
  sessionsCommand
    .command("list")
    .description("List all saved sessions")
    .action(listSessionsCommand);
  sessionsCommand
    .command("switch <name>")
    .description("Switch to a different session")
    .action(switchSessionCommand);
  clientCommand.addCommand(sessionsCommand);

  // Tools scope
  const toolsCommand = new Command("tools").description(
    "Interact with MCP tools"
  );
  toolsCommand
    .command("list")
    .description("List available tools")
    .option("--session <name>", "Use specific session")
    .option("--json", "Output as JSON")
    .action(listToolsCommand);
  toolsCommand
    .command("call <name> [args]")
    .description("Call a tool with arguments (JSON string)")
    .option("--session <name>", "Use specific session")
    .option("--timeout <ms>", "Request timeout in milliseconds", parseInt)
    .option("--json", "Output as JSON")
    .action(callToolCommand);
  toolsCommand
    .command("describe <name>")
    .description("Show tool details and schema")
    .option("--session <name>", "Use specific session")
    .action(describeToolCommand);
  clientCommand.addCommand(toolsCommand);

  // Resources scope
  const resourcesCommand = new Command("resources").description(
    "Interact with MCP resources"
  );
  resourcesCommand
    .command("list")
    .description("List available resources")
    .option("--session <name>", "Use specific session")
    .option("--json", "Output as JSON")
    .action(listResourcesCommand);
  resourcesCommand
    .command("read <uri>")
    .description("Read a resource by URI")
    .option("--session <name>", "Use specific session")
    .option("--json", "Output as JSON")
    .action(readResourceCommand);
  resourcesCommand
    .command("subscribe <uri>")
    .description("Subscribe to resource updates")
    .option("--session <name>", "Use specific session")
    .action(subscribeResourceCommand);
  resourcesCommand
    .command("unsubscribe <uri>")
    .description("Unsubscribe from resource updates")
    .option("--session <name>", "Use specific session")
    .action(unsubscribeResourceCommand);
  clientCommand.addCommand(resourcesCommand);

  // Prompts scope
  const promptsCommand = new Command("prompts").description(
    "Interact with MCP prompts"
  );
  promptsCommand
    .command("list")
    .description("List available prompts")
    .option("--session <name>", "Use specific session")
    .option("--json", "Output as JSON")
    .action(listPromptsCommand);
  promptsCommand
    .command("get <name> [args]")
    .description("Get a prompt with arguments (JSON string)")
    .option("--session <name>", "Use specific session")
    .option("--json", "Output as JSON")
    .action(getPromptCommand);
  clientCommand.addCommand(promptsCommand);

  // Interactive mode
  clientCommand
    .command("interactive")
    .description("Start interactive REPL mode")
    .option("--session <name>", "Use specific session")
    .action(interactiveCommand);

  return clientCommand;
}
