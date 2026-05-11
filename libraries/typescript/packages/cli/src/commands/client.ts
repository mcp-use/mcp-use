import chalk from "chalk";
import { Command } from "commander";
import type { MCPSession } from "mcp-use/client";
import { MCPClient } from "mcp-use/client";
import { getPackageVersion } from "mcp-use/server";
import type { NodeOAuthClientProvider } from "mcp-use/auth/node";
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
  formatToolMode,
  formatWarning,
  isStdoutTty,
} from "../utils/format.js";
import { parsePromptArgs, parseToolArgs } from "../utils/parse-args.js";
import {
  buildOAuthProvider,
  isUnauthorized,
  promptYesNo,
  runOAuthFlow,
} from "../utils/oauth.js";
import {
  getActiveSession,
  getSession,
  listAllSessions,
  saveSession,
  setActiveSession,
  updateSessionInfo,
} from "../utils/session-storage.js";
import {
  authStatusCommand,
  authRefreshCommand,
  authLogoutCommand,
} from "./client-auth.js";

// In-memory session map
const activeSessions = new Map<
  string,
  { client: MCPClient; session: MCPSession }
>();

/**
 * Close every in-memory session and exit with `code`.
 *
 * Each `client` subcommand opens a fresh transport per process invocation,
 * which keeps an HTTP/SSE socket alive after the command returns. Without
 * this, the Node event loop never goes idle and headless agents hang. We
 * call `closeAllSessions()` so the server sees a clean disconnect, then
 * force-exit to guarantee termination even if the SDK transport leaves
 * stray handles.
 */
async function cleanupAndExit(code: number): Promise<never> {
  for (const [name, { client }] of activeSessions) {
    try {
      await client.closeAllSessions();
    } catch {
      // best-effort: we're exiting anyway
    }
    activeSessions.delete(name);
  }
  process.exit(code);
}

/**
 * Get or restore a session by name. For OAuth-mode sessions whose tokens
 * have expired and can't be refreshed, prompts to re-auth on TTY or prints
 * a clear `connect` command to re-run on non-TTY.
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

  try {
    const client = new MCPClient();
    const cliClientInfo = getCliClientInfo();
    let authProvider: NodeOAuthClientProvider | undefined;

    if (config.type === "http") {
      if (config.authMode === "oauth") {
        authProvider = await buildOAuthProvider(config.url!);
        client.addServer(sessionName, {
          url: config.url!,
          authProvider,
          clientInfo: cliClientInfo,
        });
      } else {
        client.addServer(sessionName, {
          url: config.url!,
          headers: config.authToken
            ? { Authorization: `Bearer ${config.authToken}` }
            : undefined,
          clientInfo: cliClientInfo,
        });
      }
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

    let session: MCPSession;
    try {
      session = await client.createSession(sessionName);
    } catch (err) {
      // OAuth-only fallback: tokens expired and refresh failed → re-auth.
      if (
        config.type === "http" &&
        config.authMode === "oauth" &&
        authProvider &&
        isUnauthorized(err)
      ) {
        const reAuth = await promptYesNo(
          `! Tokens for session '${sessionName}' expired and could not refresh. Re-authenticate now?`,
          true
        );
        if (!reAuth) {
          console.error(formatError(`Tokens expired and could not refresh.`));
          console.error(
            formatInfo(
              `Run: mcp-use client connect ${config.url} --name ${sessionName}`
            )
          );
          return null;
        }
        await runOAuthFlow(authProvider, config.url!);
        session = await client.createSession(sessionName);
      } else {
        throw err;
      }
    }

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
    oauth?: boolean;
    authTimeout?: string;
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

      // Static --auth bypasses OAuth entirely. `--no-oauth` disables auto-OAuth
      // on 401 (commander maps `--no-oauth` to options.oauth === false).
      const wantOAuth = !options.auth && options.oauth !== false;
      let authProvider: NodeOAuthClientProvider | undefined;
      if (wantOAuth) {
        const authTimeoutMs = options.authTimeout
          ? Number.parseInt(options.authTimeout, 10)
          : undefined;
        authProvider = await buildOAuthProvider(urlOrCommand, {
          ...(authTimeoutMs ? { authTimeoutMs } : {}),
        });
      }

      client.addServer(sessionName, {
        url: urlOrCommand,
        ...(authProvider
          ? { authProvider }
          : options.auth
            ? { headers: { Authorization: `Bearer ${options.auth}` } }
            : {}),
        clientInfo: cliClientInfo,
      });

      try {
        session = await client.createSession(sessionName);
      } catch (err) {
        if (authProvider && isUnauthorized(err)) {
          console.error(
            formatWarning(
              "Server requires authentication. Starting OAuth flow."
            )
          );
          await runOAuthFlow(authProvider, urlOrCommand);
          console.error(formatSuccess("Authentication successful"));
          // Provider has tokens now; the SDK will pick them up on retry.
          session = await client.createSession(sessionName);
        } else {
          throw err;
        }
      }

      // Save session config
      await saveSession(sessionName, {
        type: "http",
        url: urlOrCommand,
        authMode: authProvider ? "oauth" : options.auth ? "bearer" : undefined,
        authToken: authProvider ? undefined : options.auth,
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
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
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
      await cleanupAndExit(0);
    }

    if (!sessionName) {
      const active = await getActiveSession();
      if (!active) {
        console.error(formatError("No active session to disconnect"));
        await cleanupAndExit(0);
      }
      sessionName = active!.name;
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
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
}

/**
 * List sessions command
 */
export async function listSessionsCommand(): Promise<void> {
  try {
    const sessions = await listAllSessions();

    if (sessions.length === 0) {
      if (isStdoutTty()) {
        console.log(formatInfo("No saved sessions"));
        console.log(
          formatInfo(
            "Connect to a server with: npx mcp-use client connect <url>"
          )
        );
      }
      return;
    }

    const tty = isStdoutTty();
    if (tty) {
      console.log(formatHeader("Saved Sessions:"));
      console.log("");
    }

    const tableData = sessions.map((s) => ({
      name: s.isActive ? chalk.green.bold(`${s.name} *`) : s.name,
      type: s.config.type,
      target:
        s.config.type === "http"
          ? s.config.url || ""
          : `${s.config.command} ${(s.config.args || []).join(" ")}`,
      server: s.config.serverInfo?.name || "unknown",
    }));

    console.log(
      formatTable(tableData, [
        { key: "name", header: "Name" },
        { key: "type", header: "Type" },
        { key: "target", header: "Target", truncate: true },
        { key: "server", header: "Server" },
      ])
    );

    if (tty) {
      console.log("");
      console.log(chalk.gray("* = active session"));
    }
  } catch (error: any) {
    console.error(formatError(`Failed to list sessions: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
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
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
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
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;
    const tools = await session.listTools();

    if (options.json) {
      console.log(formatJson(tools));
    } else if (tools.length === 0) {
      if (isStdoutTty()) console.log(formatInfo("No tools available"));
    } else {
      const tty = isStdoutTty();
      if (tty) {
        console.log(formatHeader(`Available Tools (${tools.length}):`));
        console.log("");
      }

      const tableData = tools.map((tool) => {
        const props = (tool.inputSchema as any)?.properties ?? {};
        const required = (tool.inputSchema as any)?.required ?? [];
        const total = Object.keys(props).length;
        const reqCount = Array.isArray(required) ? required.length : 0;
        const argsCell = total === 0 ? chalk.gray("—") : `${reqCount}/${total}`;
        return {
          name: chalk.bold(tool.name),
          mode: formatToolMode((tool as any).annotations),
          args: argsCell,
          description: tool.description || chalk.gray("(no description)"),
        };
      });

      console.log(
        formatTable(tableData, [
          { key: "name", header: "Tool" },
          { key: "mode", header: "Mode" },
          { key: "args", header: "Args" },
          { key: "description", header: "Description", truncate: true },
        ])
      );

      if (tty) {
        console.log("");
        console.log(
          chalk.gray(
            "ARGS shows required/total. Modes: read-only · write · destructive."
          )
        );
      }
    }
  } catch (error: any) {
    console.error(formatError(`Failed to list tools: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
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
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;
    const tools = session.tools;
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      console.error(formatError(`Tool '${toolName}' not found`));
      console.log("");
      console.log(formatInfo("Available tools:"));
      tools.forEach((t) => console.log(`  • ${t.name}`));
      await cleanupAndExit(1);
    }

    console.log(formatHeader(`Tool: ${tool!.name}`));
    console.log("");

    if (tool!.description) {
      console.log(tool!.description);
      console.log("");
    }

    if (tool!.inputSchema) {
      console.log(formatHeader("Input Schema:"));
      console.log(formatSchema(tool!.inputSchema));
    }
  } catch (error: any) {
    console.error(formatError(`Failed to describe tool: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
}

/**
 * Call tool command
 */
export async function callToolCommand(
  toolName: string,
  argsList?: string[],
  options?: { session?: string; timeout?: number; json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(options?.session || null);
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;

    const tools = session.tools;
    const tool = tools.find((t) => t.name === toolName);

    // Parse arguments: key=value pairs, key:=jsonvalue, or a single JSON object
    let args: Record<string, unknown> = {};
    if (argsList && argsList.length > 0) {
      try {
        args = parseToolArgs(argsList, tool?.inputSchema as any);
      } catch (error: any) {
        console.error(formatError(error.message));
        console.log("");
        console.log(formatInfo("Usage:"));
        console.log(
          `  npx mcp-use client tools call ${toolName} key=value [key2=value2 ...]`
        );
        console.log(
          `  npx mcp-use client tools call ${toolName} nested:='{"a":1}'   # JSON value`
        );
        console.log(
          `  npx mcp-use client tools call ${toolName} '{"key":"value"}'   # full JSON object`
        );
        if (tool?.inputSchema) {
          console.log("");
          console.log(formatInfo("Tool schema:"));
          console.log(formatSchema(tool.inputSchema));
        }
        await cleanupAndExit(1);
      }
    } else if (
      tool?.inputSchema?.required &&
      tool.inputSchema.required.length > 0
    ) {
      console.error(formatError("This tool requires arguments."));
      console.log("");
      console.log(formatInfo("Provide arguments as key=value pairs:"));
      console.log(
        `  npx mcp-use client tools call ${toolName} key=value [key2=value2 ...]`
      );
      console.log("");
      console.log(formatInfo("Tool schema:"));
      console.log(formatSchema(tool.inputSchema));
      await cleanupAndExit(1);
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

    if (callResult.isError) {
      await cleanupAndExit(1);
    }
  } catch (error: any) {
    console.error(formatError(`Failed to call tool: ${error.message}`));
    if (error?.data !== undefined) {
      console.error(
        chalk.gray(
          typeof error.data === "string" ? error.data : formatJson(error.data)
        )
      );
    }
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
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
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;
    const resourcesResult = await session.listAllResources();
    const resources = resourcesResult.resources;

    if (options.json) {
      console.log(formatJson(resources));
    } else if (resources.length === 0) {
      if (isStdoutTty()) console.log(formatInfo("No resources available"));
    } else {
      const tty = isStdoutTty();
      if (tty) {
        console.log(formatHeader(`Available Resources (${resources.length}):`));
        console.log("");
      }

      const tableData = resources.map((resource) => ({
        name: chalk.bold(resource.name || "(no name)"),
        type: resource.mimeType || chalk.gray("unknown"),
        uri: resource.uri,
      }));

      console.log(
        formatTable(tableData, [
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
          { key: "uri", header: "URI", truncate: true },
        ])
      );
    }
  } catch (error: any) {
    console.error(formatError(`Failed to list resources: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
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
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;

    console.error(formatInfo(`Reading resource: ${uri}`));
    const resource = await session.readResource(uri);

    if (options.json) {
      console.log(formatJson(resource));
    } else {
      console.log(formatResourceContent(resource));
    }
  } catch (error: any) {
    console.error(formatError(`Failed to read resource: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
}

/**
 * Subscribe to resource command
 */
export async function subscribeResourceCommand(
  uri: string,
  options: { session?: string }
): Promise<void> {
  // Subscribe is intentionally long-lived: it keeps the process alive to
  // receive notifications until Ctrl+C. Don't run cleanupAndExit on the
  // success path — only on error.
  try {
    const result = await getOrRestoreSession(options.session || null);
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;

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
    await cleanupAndExit(1);
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
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;

    await session.unsubscribeFromResource(uri);
    console.log(formatSuccess(`Unsubscribed from resource: ${uri}`));
  } catch (error: any) {
    console.error(
      formatError(`Failed to unsubscribe from resource: ${error.message}`)
    );
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
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
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;
    const promptsResult = await session.listPrompts();
    const prompts = promptsResult.prompts;

    if (options.json) {
      console.log(formatJson(prompts));
    } else if (prompts.length === 0) {
      if (isStdoutTty()) console.log(formatInfo("No prompts available"));
    } else {
      const tty = isStdoutTty();
      if (tty) {
        console.log(formatHeader(`Available Prompts (${prompts.length}):`));
        console.log("");
      }

      const tableData = prompts.map((prompt) => {
        const args = (prompt as any).arguments ?? [];
        const reqCount = Array.isArray(args)
          ? args.filter((a: any) => a?.required).length
          : 0;
        const total = Array.isArray(args) ? args.length : 0;
        const argsCell = total === 0 ? chalk.gray("—") : `${reqCount}/${total}`;
        return {
          name: chalk.bold(prompt.name),
          args: argsCell,
          description: prompt.description || chalk.gray("(no description)"),
        };
      });

      console.log(
        formatTable(tableData, [
          { key: "name", header: "Prompt" },
          { key: "args", header: "Args" },
          { key: "description", header: "Description", truncate: true },
        ])
      );
    }
  } catch (error: any) {
    console.error(formatError(`Failed to list prompts: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
}

/**
 * Get prompt command
 */
export async function getPromptCommand(
  promptName: string,
  argsList?: string[],
  options?: { session?: string; json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(options?.session || null);
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;

    // Parse arguments: key=value pairs or a single JSON object
    let args: Record<string, string> = {};
    if (argsList && argsList.length > 0) {
      try {
        args = parsePromptArgs(argsList);
      } catch (error: any) {
        console.error(formatError(error.message));
        console.log("");
        console.log(formatInfo("Usage:"));
        console.log(
          `  npx mcp-use client prompts get ${promptName} key=value [key2=value2 ...]`
        );
        console.log(
          `  npx mcp-use client prompts get ${promptName} '{"key":"value"}'   # full JSON object`
        );
        await cleanupAndExit(1);
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
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
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
        await cleanupAndExit(0);
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

    rl.on("close", async () => {
      console.log("");
      console.log(formatInfo("Goodbye!"));
      await cleanupAndExit(0);
    });
  } catch (error: any) {
    console.error(
      formatError(`Failed to start interactive mode: ${error.message}`)
    );
    await cleanupAndExit(1);
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
    .option("--auth <token>", "Static Bearer token (skips OAuth)")
    .option(
      "--no-oauth",
      "Don't auto-trigger OAuth on 401; fail with the 401 instead"
    )
    .option(
      "--auth-timeout <ms>",
      "OAuth loopback wait timeout in ms (default 300000)"
    )
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
    .command("call <name> [args...]")
    .description(
      "Call a tool. Args as key=value pairs (use key:=<json> for nested values, or pass a JSON object)"
    )
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
    .command("get <name> [args...]")
    .description(
      "Get a prompt. Args as key=value pairs (or pass a JSON object)"
    )
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

  // Auth scope (OAuth introspection / refresh / logout)
  const authCommand = new Command("auth").description(
    "Manage OAuth tokens for HTTP sessions"
  );
  authCommand
    .command("status [session]")
    .description("Show OAuth token status for a session")
    .action(authStatusCommand);
  authCommand
    .command("refresh [session]")
    .description("Force-refresh the OAuth access token")
    .action(authRefreshCommand);
  authCommand
    .command("logout [session]")
    .description("Remove stored OAuth tokens for the session's URL")
    .action(authLogoutCommand);
  clientCommand.addCommand(authCommand);

  return clientCommand;
}
