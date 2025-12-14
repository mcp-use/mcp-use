/**
 * Chat API - Single-Phase Agent Architecture with CLI Client
 *
 * Architecture:
 * - Agent builds/edits MCP server in /home/user/mcp_project
 * - Dev server (npm run dev) runs in background with auto-reload
 * - Agent uses mcp-use CLI client to connect and test the server
 * - Agent can list tools/resources, call tools, read resources using CLI commands
 * - Streams progress to client via SSE
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Sandbox } from "@e2b/code-interpreter";
import type { SandboxInfo, AgentEvent } from "../types.js";

export const chatRoutes = new Hono();

// Store active E2B sandboxes per conversation with phase tracking
export const conversationSandboxes = new Map<string, SandboxInfo>();

// Warm sandbox pool - idle sandboxes ready for immediate use
const idleSandboxPool: SandboxInfo[] = [];
const minIdleSandboxes = 1; // Minimum number of idle sandboxes to maintain
let isPreparingSandbox = false; // Flag to prevent concurrent preparation

// Directory reading configuration
const DIRECTORY_READ_TIMEOUT = 60000; // 60 seconds
const MAX_DIRECTORY_DEPTH = 5;
const MAX_FILE_SIZE = 50 * 1024; // 50KB

/**
 * Prepare a warm sandbox: create, setup, and start dev server
 */
async function prepareWarmSandbox(): Promise<SandboxInfo | null> {
  const e2bApiKey = process.env.E2B_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const e2bTemplateId = process.env.E2B_TEMPLATE_ID || "mcp-use-mango-apps-sdk";

  if (!e2bApiKey || !anthropicApiKey) {
    console.warn(
      "⚠️ E2B_API_KEY or ANTHROPIC_API_KEY not set, skipping warm sandbox"
    );
    return null;
  }

  try {
    console.log("🔥 Preparing warm sandbox...");

    // Create sandbox
    const sandbox = await Sandbox.create(e2bTemplateId, {
      apiKey: e2bApiKey,
      envs: {
        ANTHROPIC_API_KEY: anthropicApiKey,
      },
      timeoutMs: 600000, // 10 minutes
    });

    console.log(`✅ Warm sandbox created: ${sandbox.sandboxId}`);

    // Create agent-runner directory
    await sandbox.commands.run("mkdir -p /home/user/agent-runner");

    // Start dev server in background
    const devServerCmd = `cd /home/user/mcp_project && npm run dev`;
    const logFilePath = "/home/user/mcp_project/.dev-server-logs.txt";

    // Initialize log file
    await sandbox.files.write(logFilePath, "");

    // Run dev server in background
    sandbox.commands.run(devServerCmd, {
      timeoutMs: 0, // Disable timeout for long-running dev server
      onStdout: async (data) => {
        console.log("[Warm Sandbox Dev Server]", data);
      },
      onStderr: async (data) => {
        console.error("[Warm Sandbox Dev Server Error]", data);
      },
    });

    // Wait for dev server to be ready (poll port 3000)
    const devPort = 3000;
    console.log(`⏳ Waiting for warm sandbox dev server on port ${devPort}...`);

    let devServerUrl: string | null = null;
    for (let i = 0; i < 60; i++) {
      try {
        // Check if port is listening (better than trying to call /mcp which requires MCP protocol)
        const result = await sandbox.commands.run(
          `(netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null || lsof -i :${devPort} 2>/dev/null) | grep -q ":${devPort}" && echo "listening" || echo "not_listening"`
        );

        if (result.stdout && result.stdout.includes("listening")) {
          console.log(`✅ Warm sandbox dev server ready on port ${devPort}`);

          // Get E2B sandbox host for the port
          const hostname = sandbox.getHost(devPort);
          const baseUrl = hostname.startsWith("http")
            ? hostname
            : `https://${hostname}`;
          devServerUrl = `${baseUrl}/mcp`;
          break;
        }
      } catch (error) {
        // Ignore errors during polling
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!devServerUrl) {
      console.warn(
        "⚠️ Warm sandbox dev server failed to start within 60 seconds"
      );
      // Still return the sandbox, it might start later
    }

    const sandboxInfo: SandboxInfo = {
      sandbox,
      agentReady: true,
      phase: 1,
      isIdle: true,
      devServerUrl,
    };

    console.log(`🔥 Warm sandbox ready: ${sandbox.sandboxId}`);
    return sandboxInfo;
  } catch (error) {
    console.error("❌ Failed to prepare warm sandbox:", error);
    return null;
  }
}

/**
 * Ensure we have at least minIdleSandboxes in the pool
 */
async function maintainIdlePool() {
  while (idleSandboxPool.length < minIdleSandboxes && !isPreparingSandbox) {
    isPreparingSandbox = true;
    try {
      const warmSandbox = await prepareWarmSandbox();
      if (warmSandbox) {
        idleSandboxPool.push(warmSandbox);
        console.log(
          `🔥 Idle pool size: ${idleSandboxPool.length}/${minIdleSandboxes}`
        );
      }
    } catch (error) {
      console.error("❌ Error maintaining idle pool:", error);
    } finally {
      isPreparingSandbox = false;
    }
  }
}

/**
 * Claim an idle sandbox from the pool
 */
function claimIdleSandbox(conversationId: string): SandboxInfo | null {
  const sandbox = idleSandboxPool.shift();
  if (sandbox) {
    sandbox.isIdle = false;
    sandbox.conversationId = conversationId;
    // Start preparing a new one in the background
    maintainIdlePool().catch(console.error);
    console.log(
      `✅ Claimed warm sandbox ${sandbox.sandbox.sandboxId} for conversation ${conversationId}`
    );
    return sandbox;
  }
  return null;
}

// Initialize warm sandbox pool on startup
maintainIdlePool().catch((error) => {
  console.error("❌ Failed to initialize warm sandbox pool:", error);
});

/**
 * Create agent runner script for a specific phase
 */
function createAgentRunnerScript(): string {
  const systemPrompt = `You are an MCP server development and testing agent.

You are running inside an isolated E2B sandbox with full access to:
- Bash commands (npm, node, git, etc.)
- File read/write operations  
- The /home/user/mcp_project directory with a pre-scaffolded MCP server (apps-sdk template)
- The mcp-use CLI client for testing MCP servers

PROJECT STRUCTURE (you already know this):
- /home/user/mcp_project/ - Main project directory
  - src/index.ts - Main server file (edit this to add tools/resources)
  - package.json - Dependencies and scripts
  - resources/ - UI widgets directory (React components)
  - public/ - Static assets
- The project uses mcp-use framework with apps-sdk template

IMPORTANT: The dev server (npm run dev) is ALREADY RUNNING in the background!
- The server auto-reloads when you make file changes
- The server is accessible at http://localhost:3000/mcp
- You can see real-time compilation output and errors using the get_dev_server_logs tool
- Wait a few seconds before checking logs after making changes since the dev server needs time to restart
- Ignore 400 error logs since that is our client trying to reconnect to the server after reload. Only focus on typing and code error logs.

FORBIDDEN COMMANDS - NEVER USE THESE:
- npm run build - FORBIDDEN, never run this
- npm run dev - FORBIDDEN, already running
- npm start - FORBIDDEN, dev server handles this

TO CHECK FOR TYPESCRIPT ERRORS:
- Use: npx tsc --noEmit 2>&1 | head -30
- This checks types WITHOUT building
- The dev server already handles compilation and hot-reload


WORKFLOW:
1. Understand the user's requirements directly - NO initial exploration needed
2. The dev server (npm run dev) is ALREADY RUNNING - you can see live updates
3. Implement the MCP server in src/index.ts based on requirements
4. Add resources/widgets in resources/ if needed
5. Install any needed dependencies with npm install
6. Verify code compiles: run "npx tsc --noEmit" (NOT npm run build)
7. Check get_dev_server_logs to see if the dev server reloaded successfully
8. Provide a comprehensive summary of what was implemented and tested

RULES:
- You already know the project structure - do NOT explore directories at the start
- Only use tools (Read, Write, Bash) when actually implementing features
- Use markdown formatting in your responses (**, backticks, lists, etc.)
- NEVER run npm run build, npm run dev, or npm start
- To check TypeScript errors: npx tsc --noEmit
- Use get_dev_server_logs to see real-time server output and errors
- The dev server auto-reloads on file changes - watch the logs to verify

Your goal: Implement the MCP server, verify the logs, and provide a complete summary.`;

  const customToolsSetup = `
    // Create custom MCP server with get_dev_server_logs tool
    const { createSdkMcpServer, tool } = await import("@anthropic-ai/claude-agent-sdk");
    const { z } = await import("zod");
    const fs = await import("fs/promises");
    
    const customToolsServer = createSdkMcpServer({
      name: "mango-custom-tools",
      version: "1.0.0",
      tools: [
        tool(
          "get_dev_server_logs",
          "Get the last 500 lines of logs from the npm run dev server. Use this to debug issues, see compilation errors, or verify the server is running correctly. The dev server auto-reloads on file changes, so check logs after making edits to see if compilation succeeded.",
          z.object({
            lines: z.number().optional().describe("Number of lines to retrieve (max 500, default 500)")
          }),
          async (args) => {
            try {
              // Read logs from the file written by the backend
              const logFile = "/home/user/mcp_project/.dev-server-logs.txt";
              let logContent = "";
              try {
                logContent = await fs.readFile(logFile, "utf-8");
              } catch (err) {
                // File might not exist yet
                return {
                  content: [{
                    type: "text",
                    text: "Dev server logs not available yet. The server may still be starting up."
                  }]
                };
              }
              
              const allLines = logContent.split("\\n").filter(line => line.trim());
              const requestedLines = Math.min(args.lines || 500, 500);
              const lines = allLines.slice(-requestedLines);
              
              return {
                content: [{
                  type: "text",
                  text: lines.join("\\n") || "No logs available yet."
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: "text",
                  text: \`Error reading dev server logs: \${error instanceof Error ? error.message : String(error)}\`
                }]
              };
            }
          }
        )
      ]
    });`;

  return `
import { query } from "@anthropic-ai/claude-agent-sdk";

const SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)};

// Read prompt from command line args
const prompt = process.argv[2];
if (!prompt) {
  console.log(JSON.stringify({ type: "error", error: "No prompt provided" }));
  process.exit(1);
}

// Output function - writes JSON to stdout
const emit = (data) => console.log(JSON.stringify(data));

async function run() {
  try {
    emit({ type: "status", status: "starting" });
    
    // Track mapping between content block index and tool_use_id
    const contentBlockIdMap = new Map();
    
    // Prepare query parameters${customToolsSetup}
    const queryParams = {
      prompt,
      options: {
        model: "haiku",
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 50,
        allowDangerouslySkipPermissions: true,
        permissionMode: "bypassPermissions",
        includePartialMessages: true,
        disallowedTools: ["Bash"],
        cwd: "/home/user/mcp_project",
        mcpServers: {
          "mango_custom_tools": customToolsServer
        }
      }
    };
    
    for await (const event of query(queryParams)) {
      // Prioritize stream_event for real-time token streaming
      if (event.type === "stream_event") {
        // Stream events contain real-time token updates - this is the primary source for streaming
        if (event.event?.type === "message_delta" && event.event.delta?.text) {
          // Emit token chunks as they arrive
          emit({ 
            type: "token", 
            text: event.event.delta.text
          });
        } else if (event.event?.type === "content_block_delta") {
          if (event.event.delta?.text) {
            // Text content delta
            emit({ 
              type: "token", 
              text: event.event.delta.text
            });
          } else if (event.event.delta?.type === "input_json_delta" && event.event.delta?.partial_json) {
            // Tool input JSON delta - stream partial tool input
            // Get tool_use_id from the mapping using the content block index
            // The index might be in event.event.index or we might need to check content_block
            const blockIndex = event.event.index;
            const toolUseId = contentBlockIdMap.get(blockIndex) || event.event.content_block?.id;
            if (toolUseId) {
              emit({ 
                type: "tool_input_delta", 
                tool_use_id: toolUseId,
                partial_json: event.event.delta.partial_json
              });
            }
          }
        } else if (event.event?.type === "content_block_start") {
          if (event.event.content_block?.type === "text") {
            // Handle text block start - emit initial text if available
            if (event.event.content_block.text) {
              emit({ 
                type: "token", 
                text: event.event.content_block.text
              });
            }
          } else if (event.event.content_block?.type === "tool_use") {
            // Tool use block start - emit tool name and ID, and track the mapping
            const toolUseId = event.event.content_block.id;
            const contentBlockIndex = event.event.index;
            if (contentBlockIndex !== undefined) {
              contentBlockIdMap.set(contentBlockIndex, toolUseId);
            }
            emit({ 
              type: "tool_use_start", 
              tool: event.event.content_block.name,
              tool_use_id: toolUseId
            });
          }
        } else {
          // Emit other stream events as-is for debugging
          emit({ type: "stream_event", event: event.event });
        }
      } else if (event.type === "assistant") {
        // Only extract tool use blocks, not text
        // Text is already handled by stream_event above
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "tool_use") {
              // Emit tool use information - interleaved with text
              emit({ 
                type: "tool_use", 
                tool: block.name, 
                input: block.input,
                tool_use_id: block.id
              });
              if (block.name === "TodoWrite") {
                emit({ type: "todo_update", todos: block.input?.todos || [] });
              }
            }
            // Text blocks are handled by stream_event - don't emit them here to avoid duplication
          }
        }
      } else if (event.type === "tool_result") {
        // Emit tool result - this shows the output of tool calls
        emit({ 
          type: "tool_result", 
          tool_use_id: event.tool_use_id,
          result: event.result
        });
      } else if (event.type === "result") {
        emit({ type: "result", subtype: event.subtype });
      }
    }
    emit({ type: "done", completed: true });
    emit({ type: "result", subtype: "success" });
  } catch (error) {
    emit({ type: "error", error: error.message });
    emit({ type: "result", subtype: "error", error: error.message });
    process.exit(1);
  }
}

run();
`;
}

/**
 * Run agent in sandbox
 */
async function runAgent(
  sandbox: Sandbox,
  prompt: string,
  publishAndStream: (event: AgentEvent) => Promise<void>
): Promise<{ completed: boolean }> {
  console.log(`📤 Running agent in sandbox...`);

  await publishAndStream({
    type: "phase_status",
    phase: 1,
    status: "starting",
    message: `Starting agent...`,
  });

  // Start dev server immediately (unless already running)
  const devServerLogs: string[] = [];
  let devServerUrl: string | null = null;

  // Check if dev server is already running (e.g., from warm pool)
  const devPort = 3000;
  let devServerAlreadyRunning = false;

  try {
    // Check if port is listening (better than trying to call /mcp which requires MCP protocol)
    const checkResult = await sandbox.commands.run(
      `(netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null || lsof -i :${devPort} 2>/dev/null) | grep -q ":${devPort}" && echo "listening" || echo "not_listening"`
    );
    if (checkResult.stdout && checkResult.stdout.includes("listening")) {
      devServerAlreadyRunning = true;
      console.log(`✅ Dev server already running on port ${devPort}`);

      // Get the URL
      const hostname = sandbox.getHost(devPort);
      const baseUrl = hostname.startsWith("http")
        ? hostname
        : `https://${hostname}`;
      devServerUrl = `${baseUrl}/mcp`;

      await publishAndStream({
        type: "dev_server_status",
        status: "ready",
        url: devServerUrl,
        port: devPort,
        message: "Dev server is running and accessible",
      });
    }
  } catch (error) {
    // Dev server not running, continue with startup
  }

  if (!devServerAlreadyRunning) {
    await publishAndStream({
      type: "dev_server_status",
      status: "starting",
      message: "Starting dev server (npm run dev)...",
    });

    // Start dev server in background and capture logs
    const devServerCmd = `cd /home/user/mcp_project && npm run dev`;
    const logFilePath = "/home/user/mcp_project/.dev-server-logs.txt";

    // Initialize log file
    await sandbox.files.write(logFilePath, "");

    // Run dev server in background (timeoutMs: 0 to allow it to run indefinitely)
    sandbox.commands.run(devServerCmd, {
      timeoutMs: 0, // Disable timeout for long-running dev server
      onStdout: async (data) => {
        // Add to log buffer (keep last 500 lines)
        const lines = data.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          devServerLogs.push(line);
          if (devServerLogs.length > 500) {
            devServerLogs.shift();
          }
        }

        // Append to log file in sandbox
        try {
          const existingLogs = await sandbox.files
            .read(logFilePath)
            .catch(() => "");
          const allLines = existingLogs.split("\n").filter((l) => l.trim());
          allLines.push(...lines);
          // Keep last 500 lines in file
          const recentLines = allLines.slice(-500);
          await sandbox.files.write(logFilePath, recentLines.join("\n") + "\n");
        } catch (err) {
          console.warn("Failed to write dev server logs to file:", err);
        }

        console.log("[Dev Server]", data);
      },
      onStderr: async (data) => {
        // Add to log buffer (keep last 500 lines)
        const lines = data.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          devServerLogs.push(line);
          if (devServerLogs.length > 500) {
            devServerLogs.shift();
          }
        }

        // Append to log file in sandbox
        try {
          const existingLogs = await sandbox.files
            .read(logFilePath)
            .catch(() => "");
          const allLines = existingLogs.split("\n").filter((l) => l.trim());
          allLines.push(...lines);
          // Keep last 500 lines in file
          const recentLines = allLines.slice(-500);
          await sandbox.files.write(logFilePath, recentLines.join("\n") + "\n");
        } catch (err) {
          console.warn("Failed to write dev server logs to file:", err);
        }

        console.error("[Dev Server Error]", data);
      },
    });

    // Wait for dev server to be ready (poll port 3000)
    console.log(`⏳ Waiting for dev server on port ${devPort}...`);

    for (let i = 0; i < 60; i++) {
      try {
        // Check if port is listening (better than trying to call /mcp which requires MCP protocol)
        const result = await sandbox.commands.run(
          `(netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null || lsof -i :${devPort} 2>/dev/null) | grep -q ":${devPort}" && echo "listening" || echo "not_listening"`
        );

        if (result.stdout && result.stdout.includes("listening")) {
          console.log(`✅ Dev server ready on port ${devPort}`);

          // Get E2B sandbox host for the port (returns hostname like xxx-3000.e2b.dev)
          const hostname = sandbox.getHost(devPort);
          // Ensure URL has protocol
          const baseUrl = hostname.startsWith("http")
            ? hostname
            : `https://${hostname}`;
          devServerUrl = `${baseUrl}/mcp`;
          await publishAndStream({
            type: "dev_server_status",
            status: "ready",
            url: devServerUrl,
            port: devPort,
            message: "Dev server is running and accessible",
          });
          break;
        }
      } catch (error) {
        // Ignore errors during polling
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!devServerUrl) {
      await publishAndStream({
        type: "dev_server_status",
        status: "error",
        message: "Dev server failed to start within 60 seconds",
      });
    }
  }

  // Create agent runner script
  const agentScript = createAgentRunnerScript();

  // Write script to sandbox
  await sandbox.files.write("/home/user/agent-runner/index.ts", agentScript);

  // Escape the prompt for shell
  const escapedPrompt = prompt
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");

  // Run agent
  const runCmd = `cd /home/user/agent-runner && npx tsx index.ts "${escapedPrompt}"`;

  // Track if agent has completed
  let agentCompleted = false;

  // Stream response from sandbox via stdout
  const result = await sandbox.commands.run(runCmd, {
    timeoutMs: 300000, // 5 minutes for long operations
    onStdout: async (data) => {
      // Each line should be a JSON event
      const lines = data.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        try {
          const eventData = JSON.parse(line) as any;

          // Check for completion signals
          if (
            eventData.type === "done" ||
            (eventData.type === "result" && eventData.subtype === "success")
          ) {
            agentCompleted = true;
          }

          await publishAndStream(eventData);
        } catch {
          // Not JSON, log it
          console.log(`Agent output:`, line);
        }
      }
    },
    onStderr: (data) => {
      console.error(`Agent stderr:`, data);
    },
  });

  if (result.exitCode !== 0 && result.exitCode !== null) {
    console.error(`Agent exited with code ${result.exitCode}`);
    await publishAndStream({
      type: "phase_status",
      phase: 1,
      status: "error",
      message: `Agent failed with exit code ${result.exitCode}`,
    });
    return { completed: false };
  }

  if (!agentCompleted) {
    await publishAndStream({
      type: "phase_status",
      phase: 1,
      status: "warning",
      message: `Agent finished, but no explicit completion signal detected.`,
    });
    console.log(`⚠️ Agent finished without explicit completion signal`);
    return { completed: false };
  }

  await publishAndStream({
    type: "phase_status",
    phase: 1,
    status: "complete",
    message: `Agent completed successfully`,
  });

  console.log(`✅ Agent completed successfully`);
  return { completed: true };
}

/**
 * POST /api/chat/stream
 * Stream chat with two-phase agent execution
 */
chatRoutes.post("/stream", async (c) => {
  try {
    const { messages, conversationId } = await c.req.json();

    if (!messages || !Array.isArray(messages)) {
      return c.json({ error: "Invalid messages format" }, 400);
    }

    if (!conversationId) {
      return c.json({ error: "conversationId is required" }, 400);
    }

    const e2bApiKey = process.env.E2B_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const e2bTemplateId =
      process.env.E2B_TEMPLATE_ID || "mcp-use-mango-apps-sdk";

    if (!e2bApiKey || !anthropicApiKey) {
      return c.json(
        { error: "E2B_API_KEY or ANTHROPIC_API_KEY not configured" },
        500
      );
    }

    return streamSSE(c, async (stream) => {
      // Write events directly to SSE stream
      const publishAndStream = async (event: AgentEvent) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      };

      let sandboxInfo = conversationSandboxes.get(conversationId);

      try {
        // Get or create E2B sandbox
        if (!sandboxInfo) {
          // Try to claim a warm sandbox from the pool first
          const claimedSandbox = claimIdleSandbox(conversationId);

          if (claimedSandbox) {
            // Use the warm sandbox - it's already set up with dev server running
            sandboxInfo = claimedSandbox;
            conversationSandboxes.set(conversationId, sandboxInfo);

            await publishAndStream({
              type: "sandbox_status",
              status: "ready",
              sandboxId: sandboxInfo.sandbox.sandboxId,
              message: "Sandbox ready with mcp_project (apps-sdk template)",
            });

            if (sandboxInfo.devServerUrl) {
              await publishAndStream({
                type: "dev_server_status",
                status: "ready",
                url: sandboxInfo.devServerUrl,
                port: 3000,
                message: "Dev server is running and accessible",
              });
            }
          } else {
            // No warm sandbox available, create a new one (fallback)
            await publishAndStream({
              type: "sandbox_status",
              status: "creating",
              message: "Creating E2B sandbox...",
            });

            console.log(
              `🚀 Creating E2B sandbox for conversation ${conversationId}...`
            );

            const sandbox = await Sandbox.create(e2bTemplateId, {
              apiKey: e2bApiKey,
              envs: {
                ANTHROPIC_API_KEY: anthropicApiKey,
              },
              timeoutMs: 600000, // 10 minutes
            });

            console.log(`✅ Sandbox created: ${sandbox.sandboxId}`);

            // Create agent-runner directory
            await sandbox.commands.run("mkdir -p /home/user/agent-runner");

            sandboxInfo = {
              sandbox,
              agentReady: true,
              phase: 1,
              conversationId,
            };
            conversationSandboxes.set(conversationId, sandboxInfo);

            await publishAndStream({
              type: "sandbox_status",
              status: "ready",
              sandboxId: sandbox.sandboxId,
              message: "Sandbox ready with mcp_project (apps-sdk template)",
            });
          }
        }

        const { sandbox } = sandboxInfo;

        // Get last user message
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role !== "user") {
          throw new Error("Last message must be from user");
        }

        const userPrompt = lastMessage.content;

        // Run agent (single phase - agent uses CLI client to test)
        const result = await runAgent(sandbox, userPrompt, publishAndStream);

        if (result.completed) {
          sandboxInfo.phase = "complete";
        }

        // Send completion
        await publishAndStream({
          type: "stream_complete",
        });

        console.log("✅ Chat completed");
      } catch (error: any) {
        console.error("Chat error:", error);

        try {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "error",
              error: error.message,
            }),
          });
        } catch (e) {
          // Ignore errors when publishing error event
        }

        // Clean up sandbox on error
        if (sandboxInfo) {
          try {
            await sandboxInfo.sandbox.kill();
          } catch (e) {
            console.error("Error killing sandbox:", e);
          }
          conversationSandboxes.delete(conversationId);
        }
      }
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Recursively read directory structure from sandbox
 */
async function readDirectoryStructure(
  sandbox: Sandbox,
  basePath: string,
  maxFileSize: number = MAX_FILE_SIZE,
  maxDepth: number = MAX_DIRECTORY_DEPTH,
  currentDepth: number = 0
): Promise<any> {
  try {
    // List directory contents
    const result = await sandbox.commands.run(
      `find "${basePath}" -mindepth 1 -maxdepth 1 2>/dev/null | sort`,
      { timeoutMs: DIRECTORY_READ_TIMEOUT }
    );

    if (!result.stdout) {
      return null;
    }

    const entries = result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim());

    const children: any[] = [];

    for (const entry of entries) {
      const fullPath = entry.trim();
      const name = fullPath.split("/").pop() || fullPath;

      // Skip hidden files and common build/cache directories
      if (
        name.startsWith(".") ||
        name === "node_modules" ||
        name === "dist" ||
        name === ".next" ||
        name === ".git"
      ) {
        continue;
      }

      // Check if it's a directory
      const statResult = await sandbox.commands.run(
        `stat -c "%F" "${fullPath}" 2>/dev/null || echo "unknown"`,
        { timeoutMs: DIRECTORY_READ_TIMEOUT }
      );

      const isDirectory = statResult.stdout?.includes("directory") || false;

      if (isDirectory) {
        // Check depth limit before recursing
        if (currentDepth >= maxDepth) {
          children.push({
            path: fullPath,
            name,
            type: "directory",
            children: [], // Don't read deeper
          });
          continue;
        }

        // Recursively read directory
        const dirChildren = await readDirectoryStructure(
          sandbox,
          fullPath,
          maxFileSize,
          maxDepth,
          currentDepth + 1
        );
        children.push({
          path: fullPath,
          name,
          type: "directory",
          children: dirChildren?.children || [],
        });
      } else {
        // Read file content (with size limit)
        let content: string | undefined;
        let size = 0;
        let truncated = false;

        try {
          const sizeResult = await sandbox.commands.run(
            `stat -c "%s" "${fullPath}" 2>/dev/null || echo "0"`
          );
          size = parseInt(sizeResult.stdout?.trim() || "0", 10);

          if (size <= maxFileSize) {
            try {
              const fileContent = await sandbox.files.read(fullPath);
              // Check if file is text (not binary)
              if (typeof fileContent === "string") {
                // Check for binary content
                const hasNullBytes = fileContent.includes("\0");
                if (!hasNullBytes) {
                  content = fileContent;
                } else {
                  content = undefined; // Binary file
                }
              }
            } catch (readError) {
              // File might be too large or unreadable
              content = undefined;
            }
          } else {
            truncated = true;
            // Read first part of large file
            try {
              const headResult = await sandbox.commands.run(
                `head -c ${maxFileSize} "${fullPath}" 2>/dev/null || echo ""`,
                { timeoutMs: DIRECTORY_READ_TIMEOUT }
              );
              if (headResult.stdout) {
                content = headResult.stdout;
              }
            } catch {
              // Ignore errors
            }
          }
        } catch (error) {
          // Ignore file read errors
        }

        children.push({
          path: fullPath,
          name,
          type: "file",
          size,
          content,
          truncated,
        });
      }
    }

    return { path: basePath, children };
  } catch (error: any) {
    // Check if it's a timeout error
    if (
      error?.name === "TimeoutError" ||
      error?.message?.includes("timeout") ||
      error?.message?.includes("TimeoutError")
    ) {
      console.error(
        `Timeout reading directory ${basePath} at depth ${currentDepth}:`,
        error.message
      );
      // Return partial results instead of failing completely
      return {
        path: basePath,
        children: [],
        error: "Timeout reading directory",
      };
    }
    console.error(
      `Error reading directory ${basePath} at depth ${currentDepth}:`,
      error
    );
    return null;
  }
}

/**
 * GET /api/chat/project-files
 * Get the mcp_project folder structure from the sandbox
 */
chatRoutes.get("/project-files", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");

    if (!conversationId) {
      return c.json({ error: "conversationId required" }, 400);
    }

    const sandboxInfo = conversationSandboxes.get(conversationId);

    if (!sandboxInfo) {
      return c.json({ error: "Sandbox not found for this conversation" }, 404);
    }

    const projectPath = "/home/user/mcp_project";
    const structure = await readDirectoryStructure(
      sandboxInfo.sandbox,
      projectPath,
      MAX_FILE_SIZE,
      MAX_DIRECTORY_DEPTH,
      0
    );

    if (!structure) {
      return c.json({ error: "Failed to read project directory" }, 500);
    }

    return c.json(structure);
  } catch (error: any) {
    console.error("Project files error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chat/cleanup
 * Clean up a conversation sandbox
 */
chatRoutes.post("/cleanup", async (c) => {
  try {
    const { conversationId } = await c.req.json();

    if (!conversationId) {
      return c.json({ error: "conversationId required" }, 400);
    }

    const sandboxInfo = conversationSandboxes.get(conversationId);

    if (sandboxInfo) {
      console.log(
        `🧹 Cleaning up sandbox for conversation ${conversationId}...`
      );
      try {
        await sandboxInfo.sandbox.kill();
      } catch (e) {
        console.error("Error killing sandbox:", e);
      }
      conversationSandboxes.delete(conversationId);
      console.log("✅ Sandbox cleaned up");
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Cleanup error:", error);
    return c.json({ error: error.message }, 500);
  }
});
