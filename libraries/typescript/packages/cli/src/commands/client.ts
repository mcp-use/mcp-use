import chalk from "chalk";
import { Command } from "commander";
import type { MCPSession } from "mcp-use/client";
import { MCPClient } from "mcp-use/client";
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
  runOAuthFlow,
} from "../utils/oauth.js";
import {
  getSession,
  listAllSessions,
  removeSession,
  saveSession,
  updateSessionInfo,
} from "../utils/session-storage.js";
import {
  activeSessions,
  cleanupAndExit,
  getCliClientInfo,
  getOrRestoreSession,
} from "../utils/session.js";
import {
  authStatusCommand,
  authRefreshCommand,
  authLogoutCommand,
} from "./client-auth.js";
import {
  captureToolScreenshot,
  createClientScreenshotCommand,
  createPerClientScreenshotCommand,
  detectToolResourceUri,
  parseDeviceScaleFactor,
} from "./screenshot.js";

/**
 * Reserved top-level subcommands under `mcp-use client`. Any other token in
 * that position is treated as a client name and routed via
 * `createPerClientCommand`. Keep this in sync with the subcommands registered
 * in `createClientCommand` below, plus commander's built-in help tokens.
 */
export const RESERVED_CLIENT_SUBCOMMANDS = new Set([
  "connect",
  "list",
  "remove",
  "screenshot",
  "help",
]);

/**
 * Per-client scope tokens that live under `mcp-use client <name> ...`. When a
 * user types one of these in the client-name slot (e.g.
 * `mcp-use client tools call foo`), they almost certainly forgot the client
 * name — route to a tailored error instead of "unknown command".
 */
export const PER_CLIENT_SCOPES = new Set([
  "tools",
  "resources",
  "prompts",
  "auth",
  "disconnect",
  "interactive",
  "screenshot",
]);

export async function connectCommand(
  name: string | undefined,
  urlOrCommand: string | undefined,
  options: {
    stdio?: boolean;
    auth?: string;
    oauth?: boolean;
    authTimeout?: string;
  }
): Promise<void> {
  // `connect` requires both <name> and <url>. Commander's default missing-arg
  // error ("missing required argument 'url'") is confusing when users pass a
  // URL as the only positional — they don't realize the server needs a name.
  // Catch the common shapes here and give a tailored fix-it message.
  if (!name || !urlOrCommand) {
    const looksLikeUrl = !!name && /^https?:\/\//i.test(name);

    if (looksLikeUrl && !urlOrCommand && !options.stdio) {
      console.error(formatError("Missing server name."));
      console.error("");
      console.error(
        formatInfo(
          "Each saved server needs a short name you'll use to address it later."
        )
      );
      console.error("");
      console.error("Try:");
      console.error(`  mcp-use client connect <name> ${name}`);
      console.error("");
      console.error("Example:");
      console.error(`  mcp-use client connect my-server ${name}`);
      console.error("  mcp-use client my-server tools list");
    } else if (name && !urlOrCommand) {
      console.error(
        formatError(options.stdio ? "Missing <command>." : "Missing <url>.")
      );
      console.error("");
      console.error(formatInfo("Usage:"));
      console.error(
        options.stdio
          ? `  mcp-use client connect ${name} "<command>" --stdio`
          : `  mcp-use client connect ${name} <url>`
      );
    } else {
      console.error(formatError("Missing required arguments: <name> <url>."));
      console.error("");
      console.error(formatInfo("Usage:"));
      console.error("  mcp-use client connect <name> <url>");
      console.error("");
      console.error("Example:");
      console.error(
        "  mcp-use client connect manufact https://mcp.manufact.com/mcp"
      );
    }
    await cleanupAndExit(1);
  }

  // Narrow for TS: the validation block above exits on missing args. The
  // `await cleanupAndExit` doesn't propagate `never` through control flow,
  // so assert here once instead of sprinkling `!` everywhere.
  const sessionName: string = name as string;
  const target: string = urlOrCommand as string;

  // Reject names that collide with per-server scope tokens. If someone saved a
  // server as `tools`, every `mcp-use client tools ...` invocation would be
  // intercepted by the "missing server name" routing in index.ts and the
  // saved entry would be unreachable. Fail fast at save time instead.
  if (PER_CLIENT_SCOPES.has(sessionName)) {
    console.error(
      formatError(
        `'${sessionName}' is a reserved name and can't be used for a saved server.`
      )
    );
    console.error("");
    console.error(
      `Reserved names: ${Array.from(PER_CLIENT_SCOPES).sort().join(", ")}`
    );
    console.error("");
    console.error("Pick a different name, e.g.:");
    console.error(`  mcp-use client connect my-${sessionName} ${target}`);
    await cleanupAndExit(1);
  }

  try {
    const client = new MCPClient();
    let session: MCPSession;
    const cliClientInfo = getCliClientInfo();

    if (options.stdio) {
      const parts = target.split(" ");
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

      await saveSession(sessionName, {
        type: "stdio",
        command,
        args,
        lastUsed: new Date().toISOString(),
      });
    } else {
      console.error(formatInfo(`Connecting to ${target}...`));

      // Static --auth bypasses OAuth entirely. `--no-oauth` disables auto-OAuth
      // on 401 (commander maps `--no-oauth` to options.oauth === false).
      const wantOAuth = !options.auth && options.oauth !== false;
      let authProvider: NodeOAuthClientProvider | undefined;
      if (wantOAuth) {
        const authTimeoutMs = options.authTimeout
          ? Number.parseInt(options.authTimeout, 10)
          : undefined;
        authProvider = await buildOAuthProvider(target, {
          ...(authTimeoutMs ? { authTimeoutMs } : {}),
        });
      }

      client.addServer(sessionName, {
        url: target,
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
          await runOAuthFlow(authProvider, target);
          console.error(formatSuccess("Authentication successful"));
          session = await client.createSession(sessionName);
        } else {
          throw err;
        }
      }

      await saveSession(sessionName, {
        type: "http",
        url: target,
        authMode: authProvider ? "oauth" : options.auth ? "bearer" : undefined,
        authToken: authProvider ? undefined : options.auth,
        lastUsed: new Date().toISOString(),
      });
    }

    activeSessions.set(sessionName, { client, session });

    const serverInfo = session.serverInfo;
    const capabilities = session.serverCapabilities;

    if (serverInfo) {
      await updateSessionInfo(sessionName, serverInfo, capabilities);
    }

    console.log(formatSuccess(`Connected as '${sessionName}'`));

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

export async function disconnectCommand(name: string): Promise<void> {
  try {
    const sessionData = activeSessions.get(name);
    if (sessionData) {
      await sessionData.client.closeAllSessions();
      activeSessions.delete(name);
      console.log(formatSuccess(`Disconnected from ${name}`));
    } else {
      console.log(formatInfo(`Server '${name}' is not connected`));
    }
  } catch (error: any) {
    console.error(formatError(`Failed to disconnect: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
}

export async function removeClientCommand(name: string): Promise<void> {
  try {
    const config = await getSession(name);
    if (!config) {
      console.error(formatError(`Server '${name}' not found`));
      console.error("");
      console.error("See your saved servers with:");
      console.error("  mcp-use client list");
      await cleanupAndExit(1);
    }

    const sessionData = activeSessions.get(name);
    if (sessionData) {
      await sessionData.client.closeAllSessions();
      activeSessions.delete(name);
    }

    // OAuth tokens are keyed by URL hash, not by saved-server name, so two
    // saved entries pointing at the same URL share one token store. Only
    // wipe the tokens when this entry is the last one using the URL.
    const isOAuthHttp =
      config!.type === "http" &&
      config!.authMode === "oauth" &&
      typeof config!.url === "string";
    const sharedUrlSibling = isOAuthHttp
      ? (await listAllSessions()).find(
          (s) =>
            s.name !== name &&
            s.config.type === "http" &&
            s.config.url === config!.url
        )
      : undefined;

    await removeSession(name);
    console.log(formatSuccess(`Removed saved server '${name}'`));

    if (isOAuthHttp) {
      if (sharedUrlSibling) {
        console.log(
          formatInfo(
            `OAuth tokens for ${config!.url} were kept because saved server '${sharedUrlSibling.name}' still uses that URL.`
          )
        );
      } else {
        try {
          const provider = await buildOAuthProvider(config!.url!);
          await provider.invalidateCredentials("all");
          console.log(formatInfo(`Removed OAuth tokens for ${config!.url}`));
        } catch (error: any) {
          console.error(
            formatWarning(
              `Saved entry removed, but failed to clear OAuth tokens for ${config!.url}: ${error.message}`
            )
          );
        }
      }
    }
  } catch (error: any) {
    console.error(formatError(`Failed to remove server: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
}

export async function listClientsCommand(): Promise<void> {
  try {
    const sessions = await listAllSessions();

    if (sessions.length === 0) {
      if (isStdoutTty()) {
        console.log(formatInfo("No saved servers"));
        console.log(
          formatInfo(
            "Connect to a server with: npx mcp-use client connect <name> <url>"
          )
        );
      }
      return;
    }

    const tty = isStdoutTty();
    if (tty) {
      console.log(formatHeader("Saved Servers:"));
      console.log("");
    }

    const tableData = sessions.map((s) => ({
      name: s.name,
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
  } catch (error: any) {
    console.error(formatError(`Failed to list servers: ${error.message}`));
    await cleanupAndExit(1);
  }
  await cleanupAndExit(0);
}

export async function listToolsCommand(
  name: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
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

export async function describeToolCommand(
  name: string,
  toolName: string
): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
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

export async function callToolCommand(
  name: string,
  toolName: string,
  argsList?: string[],
  options?: {
    timeout?: number;
    json?: boolean;
    screenshot?: boolean;
    screenshotOutput?: string;
    screenshotDeviceScaleFactor?: string;
  }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;

    const tools = session.tools;
    const tool = tools.find((t) => t.name === toolName);

    let args: Record<string, unknown> = {};
    if (argsList && argsList.length > 0) {
      try {
        args = parseToolArgs(argsList, tool?.inputSchema as any);
      } catch (error: any) {
        console.error(formatError(error.message));
        console.log("");
        console.log(formatInfo("Usage:"));
        console.log(
          `  npx mcp-use client ${name} tools call ${toolName} key=value [key2=value2 ...]`
        );
        console.log(
          `  npx mcp-use client ${name} tools call ${toolName} nested:='{"a":1}'   # JSON value`
        );
        console.log(
          `  npx mcp-use client ${name} tools call ${toolName} '{"key":"value"}'   # full JSON object`
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
        `  npx mcp-use client ${name} tools call ${toolName} key=value [key2=value2 ...]`
      );
      console.log("");
      console.log(formatInfo("Tool schema:"));
      console.log(formatSchema(tool.inputSchema));
      await cleanupAndExit(1);
    }

    console.error(formatInfo(`Calling tool '${toolName}'...`));
    const callResult = await session.callTool(toolName, args, {
      timeout: options?.timeout,
    });

    // Screenshot is opt-in via --screenshot. Any of the screenshot-related
    // flags also implies opt-in so users don't have to pass `--screenshot`
    // alongside `--screenshot-output`. Capture before printing so the path is
    // part of the printed result — agents reading `--json` output get it
    // inside the JSON. Failures don't fail the tool call.
    const toolWithMeta = session.tools.find((t) => t.name === toolName);
    const resourceUri = detectToolResourceUri(toolWithMeta);
    const wantsScreenshot =
      options?.screenshot === true ||
      options?.screenshotOutput !== undefined ||
      options?.screenshotDeviceScaleFactor !== undefined;

    let screenshot: {
      path: string;
      width: number;
      height: number;
      view: string;
    } | null = null;
    let screenshotError: string | null = null;
    let widgetHintUri: string | null = null;
    if (resourceUri) {
      if (wantsScreenshot) {
        console.error(
          formatInfo(`Capturing widget screenshot (${resourceUri})...`)
        );
        try {
          const screenshotOpts: {
            output?: string;
            deviceScaleFactor?: number;
          } = {};
          if (options?.screenshotOutput) {
            screenshotOpts.output = options.screenshotOutput;
          }
          if (options?.screenshotDeviceScaleFactor) {
            screenshotOpts.deviceScaleFactor = parseDeviceScaleFactor(
              options.screenshotDeviceScaleFactor
            );
          }
          const shot = await captureToolScreenshot(
            {
              session,
              toolName,
              toolArgs: args,
              toolOutput: callResult,
              resourceUri,
            },
            screenshotOpts
          );
          screenshot = {
            path: shot.outputPath,
            width: shot.width,
            height: shot.height,
            view: shot.view,
          };
        } catch (err: any) {
          screenshotError = err?.message ?? String(err);
        }
      } else {
        widgetHintUri = resourceUri;
      }
    }

    if (options?.json) {
      console.log(formatJson(callResult));
    } else {
      console.log(formatToolCall(callResult));
    }

    if (screenshot) {
      // Always announce the screenshot on stderr so `--json` stdout stays a
      // clean CallToolResult — agents piping JSON shouldn't have to filter
      // status lines out of their parse target.
      console.error(
        formatSuccess(
          `Saved widget screenshot: ${screenshot.path} (${screenshot.width}×${screenshot.height})`
        )
      );
    }
    if (screenshotError) {
      console.error(
        formatWarning(`Skipped widget screenshot: ${screenshotError}`)
      );
    }
    if (widgetHintUri) {
      console.error(
        formatInfo(
          `This tool renders a widget (${widgetHintUri}). Re-run with --screenshot to save a PNG of it.`
        )
      );
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

export async function listResourcesCommand(
  name: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
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

export async function readResourceCommand(
  name: string,
  uri: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
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

export async function subscribeResourceCommand(
  name: string,
  uri: string
): Promise<void> {
  // Subscribe is intentionally long-lived: it keeps the process alive to
  // receive notifications until Ctrl+C. Don't run cleanupAndExit on the
  // success path — only on error.
  try {
    const result = await getOrRestoreSession(name);
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;

    await session.subscribeToResource(uri);
    console.log(formatSuccess(`Subscribed to resource: ${uri}`));

    session.on("notification", async (notification) => {
      if (notification.method === "notifications/resources/updated") {
        console.log("");
        console.log(formatInfo("Resource updated:"));
        console.log(formatJson(notification.params));
      }
    });

    console.log(formatInfo("Listening for updates... (Press Ctrl+C to stop)"));

    await new Promise(() => {});
  } catch (error: any) {
    console.error(
      formatError(`Failed to subscribe to resource: ${error.message}`)
    );
    await cleanupAndExit(1);
  }
}

export async function unsubscribeResourceCommand(
  name: string,
  uri: string
): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
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

export async function listPromptsCommand(
  name: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
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

export async function getPromptCommand(
  name: string,
  promptName: string,
  argsList?: string[],
  options?: { json?: boolean }
): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
    if (!result) {
      await cleanupAndExit(1);
    }

    const { session } = result!;

    let args: Record<string, string> = {};
    if (argsList && argsList.length > 0) {
      try {
        args = parsePromptArgs(argsList);
      } catch (error: any) {
        console.error(formatError(error.message));
        console.log("");
        console.log(formatInfo("Usage:"));
        console.log(
          `  npx mcp-use client ${name} prompts get ${promptName} key=value [key2=value2 ...]`
        );
        console.log(
          `  npx mcp-use client ${name} prompts get ${promptName} '{"key":"value"}'   # full JSON object`
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

export async function interactiveCommand(name: string): Promise<void> {
  try {
    const result = await getOrRestoreSession(name);
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
            // TODO(mcp-1566): mirror the auto widget-screenshot flow from
            // `client tools call` here. Skipped for now to keep the REPL terse.
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
        } else {
          console.error(
            formatError(
              "Unknown command. Type a valid scope: tools, resources, prompts"
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
 * Top-level `client` command. Exposes only commands that do not target an
 * existing saved server: `connect` (which creates one) and `list`. Per-server
 * operations live under `createPerClientCommand(<name>)` and are routed by
 * `index.ts` based on the positional after `client`.
 */
export function createClientCommand(): Command {
  const clientCommand = new Command("client")
    .description(
      "Interactive MCP client for terminal usage. Use `mcp-use client <name> ...` to run commands against a saved server."
    )
    .showHelpAfterError(
      "(Run `mcp-use client --help` to see available commands)"
    );

  clientCommand
    .command("connect [name] [url]")
    .description(
      "Connect to an MCP server and save it under a short name. Use the name to address it in later commands (e.g. `mcp-use client <name> tools list`)."
    )
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
    .command("list")
    .description("List saved servers")
    .action(listClientsCommand);

  clientCommand
    .command("remove <name>")
    .description(
      "Remove a saved server. Also clears any OAuth tokens for that URL, unless another saved server still uses it."
    )
    .action(removeClientCommand);

  clientCommand.addCommand(createClientScreenshotCommand());

  return clientCommand;
}

/**
 * Build the per-server command subtree for a given saved-server name. The
 * name is captured in each action closure so subcommand definitions stay
 * free of an extra positional argument.
 */
export function createPerClientCommand(name: string): Command {
  const cmd = new Command(`mcp-use client ${name}`)
    .description(`Commands for server '${name}'`)
    .showHelpAfterError(
      `(Run \`mcp-use client ${name} --help\` to see available commands)`
    );

  cmd
    .command("disconnect")
    .description("Disconnect from this server")
    .action(() => disconnectCommand(name));

  cmd
    .command("interactive")
    .description("Start interactive REPL mode for this server")
    .action(() => interactiveCommand(name));

  const toolsCommand = new Command("tools")
    .description("Interact with MCP tools")
    .showHelpAfterError(
      `(Run \`mcp-use client ${name} tools --help\` to see available actions)`
    );
  toolsCommand
    .command("list")
    .description("List available tools")
    .option("--json", "Output as JSON")
    .action((options) => listToolsCommand(name, options));
  toolsCommand
    .command("call <tool> [args...]")
    .description(
      "Call a tool. Args as key=value pairs (use key:=<json> for nested values, or pass a JSON object)"
    )
    .option("--timeout <ms>", "Request timeout in milliseconds", parseInt)
    .option("--json", "Output as JSON")
    .option(
      "--screenshot",
      "Capture a PNG screenshot of the rendered widget for tools that declare a UI resource"
    )
    .option(
      "--screenshot-output <path>",
      "Output PNG path for the widget screenshot (implies --screenshot; defaults to ./<view>-<timestamp>.png)"
    )
    .option(
      "--screenshot-device-scale-factor <n>",
      "Device pixel ratio for the widget screenshot (implies --screenshot; e.g. 2 for Retina). Defaults to 1."
    )
    .action((tool, args, options) =>
      callToolCommand(name, tool, args, options)
    );
  toolsCommand
    .command("describe <tool>")
    .description("Show tool details and schema")
    .action((tool) => describeToolCommand(name, tool));
  cmd.addCommand(toolsCommand);

  const resourcesCommand = new Command("resources")
    .description("Interact with MCP resources")
    .showHelpAfterError(
      `(Run \`mcp-use client ${name} resources --help\` to see available actions)`
    );
  resourcesCommand
    .command("list")
    .description("List available resources")
    .option("--json", "Output as JSON")
    .action((options) => listResourcesCommand(name, options));
  resourcesCommand
    .command("read <uri>")
    .description("Read a resource by URI")
    .option("--json", "Output as JSON")
    .action((uri, options) => readResourceCommand(name, uri, options));
  resourcesCommand
    .command("subscribe <uri>")
    .description("Subscribe to resource updates")
    .action((uri) => subscribeResourceCommand(name, uri));
  resourcesCommand
    .command("unsubscribe <uri>")
    .description("Unsubscribe from resource updates")
    .action((uri) => unsubscribeResourceCommand(name, uri));
  cmd.addCommand(resourcesCommand);

  const promptsCommand = new Command("prompts")
    .description("Interact with MCP prompts")
    .showHelpAfterError(
      `(Run \`mcp-use client ${name} prompts --help\` to see available actions)`
    );
  promptsCommand
    .command("list")
    .description("List available prompts")
    .option("--json", "Output as JSON")
    .action((options) => listPromptsCommand(name, options));
  promptsCommand
    .command("get <prompt> [args...]")
    .description(
      "Get a prompt. Args as key=value pairs (or pass a JSON object)"
    )
    .option("--json", "Output as JSON")
    .action((prompt, args, options) =>
      getPromptCommand(name, prompt, args, options)
    );
  cmd.addCommand(promptsCommand);

  const authCommand = new Command("auth")
    .description("Manage OAuth tokens for HTTP servers")
    .showHelpAfterError(
      `(Run \`mcp-use client ${name} auth --help\` to see available actions)`
    );
  authCommand
    .command("status")
    .description("Show OAuth token status for this server")
    .action(() => authStatusCommand(name));
  authCommand
    .command("refresh")
    .description("Force-refresh the OAuth access token")
    .action(() => authRefreshCommand(name));
  authCommand
    .command("logout")
    .description("Remove stored OAuth tokens for this server's URL")
    .action(() => authLogoutCommand(name));
  cmd.addCommand(authCommand);

  cmd.addCommand(createPerClientScreenshotCommand(name));

  return cmd;
}
