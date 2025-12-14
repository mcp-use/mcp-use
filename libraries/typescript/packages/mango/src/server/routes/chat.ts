/**
 * Chat API - Two-Phase Agent Architecture with MCP Connector
 *
 * Architecture:
 * Phase 1: Build MCP Server
 * - Agent builds/edits MCP server in /home/user/mcp_project
 * - Uses standard tools: Read, Write, Edit, Bash, etc.
 * - Streams progress to client via SSE
 *
 * Phase 2: Test with MCP Connector
 * - Starts MCP server in background
 * - Re-runs agent with MCP connector configured
 * - Agent can now call MCP tools to test the server
 * - Streams test results to client via SSE
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Sandbox } from "@e2b/code-interpreter";
import type { SandboxInfo, AgentEvent } from "../types.js";

export const chatRoutes = new Hono();

// Store active E2B sandboxes per conversation with phase tracking
const conversationSandboxes = new Map<string, SandboxInfo>();

/**
 * Create agent runner script for a specific phase
 */
function createAgentRunnerScript(phase: 1 | 2, mcpServerPort?: number): string {
  const systemPrompt =
    phase === 1
      ? `You are an MCP server development agent.

You are running inside an isolated E2B sandbox with full access to:
- Bash commands (npm, node, git, etc.)
- File read/write operations  
- The /home/user/mcp_project directory with a pre-scaffolded MCP server (apps-sdk template)

PROJECT STRUCTURE (you already know this):
- /home/user/mcp_project/ - Main project directory
  - src/index.ts - Main server file (edit this to add tools/resources)
  - package.json - Dependencies and scripts
  - resources/ - UI widgets directory (React components)
  - public/ - Static assets
- The project uses mcp-use framework with apps-sdk template
- Standard scripts: npm run build, npm run dev, npm start

WORKFLOW:
1. Understand the user's requirements directly - NO initial exploration needed
2. Implement the MCP server in src/index.ts based on requirements
3. Add resources/widgets in resources/ if needed
4. Install any needed dependencies with npm install
5. Test with: npm run build
6. When the server is COMPLETE and READY for testing, call the start_server tool
7. Only call start_server when you have finished implementing and testing the build

RULES:
- You already know the project structure - do NOT explore directories at the start
- Only use tools (Read, Write, Bash) when actually implementing features
- Use markdown formatting in your responses (**, backticks, lists, etc.)
- Test your changes with npm run build before calling start_server
- DO NOT manually start the server - use the start_server tool when ready

IMPORTANT: Only call start_server when:
- All user requirements are implemented
- The code builds successfully (npm run build works)
- The server is ready to be tested

Your goal: Build a working MCP server that meets all user requirements, then call start_server when ready.`
      : `You are an MCP server testing agent.

The MCP server has been built and is now running on localhost:${mcpServerPort}.
You have access to all the MCP tools exposed by this server via the MCP connector.

WORKFLOW:
1. List available MCP tools using ListMcpResources
2. Test the MCP tools by calling them with various inputs
3. Verify the server works as expected
4. Report any issues or successes

RULES:
- Test all MCP tools thoroughly
- Try edge cases and error scenarios
- Report results clearly
- Be concise but thorough

Your goal: Verify the MCP server works correctly and meets requirements.`;

  const mcpConfig =
    phase === 2
      ? `
    mcpServers: {
      "mcp_project": {
        type: "sse",
        url: "http://localhost:${mcpServerPort}/mcp",
        name: "mcp_project"
      }
    },
    tools: [
      {
        type: "mcp_toolset",
        mcp_server_name: "mcp_project"
      }
    ],
    betas: ["mcp-client-2025-11-20"],`
      : `
    `;

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
    emit({ type: "status", status: "starting", phase: ${phase} });
    
    for await (const event of query({
      prompt,
      options: {
        model: "haiku",
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: ${phase === 1 ? 50 : 30},
        allowDangerouslySkipPermissions: true,
        permissionMode: "bypassPermissions",
        includePartialMessages: true,
        cwd: "/home/user/mcp_project",${mcpConfig}
      }
    })) {
      // Prioritize stream_event for real-time token streaming
      if (event.type === "stream_event") {
        // Stream events contain real-time token updates - this is the primary source for streaming
        if (event.event?.type === "message_delta" && event.event.delta?.text) {
          // Emit token chunks as they arrive
          emit({ 
            type: "token", 
            text: event.event.delta.text, 
            phase: ${phase} 
          });
        } else if (event.event?.type === "content_block_delta" && event.event.delta?.text) {
          // Alternative event format for content blocks
          emit({ 
            type: "token", 
            text: event.event.delta.text, 
            phase: ${phase} 
          });
        } else if (event.event?.type === "content_block_start" && event.event.content_block?.type === "text") {
          // Handle text block start - emit initial text if available
          if (event.event.content_block.text) {
            emit({ 
              type: "token", 
              text: event.event.content_block.text, 
              phase: ${phase} 
            });
          }
        } else {
          // Emit other stream events as-is for debugging
          emit({ type: "stream_event", event: event.event, phase: ${phase} });
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
                tool_use_id: block.id,
                phase: ${phase} 
              });
              if (block.name === "TodoWrite") {
                emit({ type: "todo_update", todos: block.input?.todos || [], phase: ${phase} });
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
          result: event.result,
          phase: ${phase} 
        });
        
        // For Phase 1, check if start_server was called
        if (${phase} === 1 && event.tool_use_id) {
          // We need to check if this result is for start_server
          // The tool_use_id will match the tool call we saw earlier
        }
      } else if (event.type === "result") {
        emit({ type: "result", subtype: event.subtype, phase: ${phase} });
      }
    }
    emit({ type: "done", phase: ${phase}, completed: true });
    emit({ type: "result", subtype: "success", phase: ${phase} });
  } catch (error) {
    emit({ type: "error", error: error.message, phase: ${phase} });
    emit({ type: "result", subtype: "error", error: error.message, phase: ${phase} });
    process.exit(1);
  }
}

run();
`;
}

/**
 * Start MCP server in sandbox
 */
async function startMcpServer(
  sandbox: Sandbox,
  publishAndStream: (event: AgentEvent) => Promise<void>
): Promise<number> {
  await publishAndStream({
    type: "mcp_status",
    status: "starting",
    message: "Starting MCP server...",
  });

  console.log("🚀 Starting MCP server in sandbox...");

  // Start server in background
  const startCmd = `cd /home/user/mcp_project && npm start`;

  // Run in background
  sandbox.commands.run(startCmd, {
    onStdout: (data) => console.log("[MCP Server]", data),
    onStderr: (data) => console.error("[MCP Server Error]", data),
  });

  // Wait for server to be ready (poll health endpoint)
  const mcpPort = 3000; // Default mcp-use port
  console.log(`⏳ Waiting for MCP server on port ${mcpPort}...`);

  for (let i = 0; i < 30; i++) {
    try {
      const result = await sandbox.commands.run(
        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${mcpPort}/sse || echo "000"`
      );

      if (result.stdout && !result.stdout.includes("000")) {
        console.log(`✅ MCP server ready on port ${mcpPort}`);
        await publishAndStream({
          type: "mcp_status",
          status: "ready",
          port: mcpPort,
          message: "MCP server is running",
        });
        return mcpPort;
      }
    } catch (error) {
      // Ignore errors during polling
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("MCP server failed to start within 30 seconds");
}

/**
 * Run agent in sandbox for a specific phase
 */
async function runAgentPhase(
  sandbox: Sandbox,
  prompt: string,
  phase: 1 | 2,
  publishAndStream: (event: AgentEvent) => Promise<void>,
  mcpServerPort?: number
): Promise<{ completed: boolean; serverReady: boolean }> {
  console.log(`📤 Running agent Phase ${phase} in sandbox...`);

  await publishAndStream({
    type: "phase_status",
    phase,
    status: "starting",
    message: `Starting Phase ${phase}...`,
  });

  // Create agent runner script for this phase
  const agentScript = createAgentRunnerScript(phase, mcpServerPort);

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

  // Track if agent has completed and if start_server was called
  let agentCompleted = false;
  let serverReadyCalled = false;
  const startServerToolIds = new Set<string>();

  // Stream response from sandbox via stdout
  const result = await sandbox.commands.run(runCmd, {
    timeoutMs: 300000, // 5 minutes for long operations
    onStdout: async (data) => {
      // Each line should be a JSON event
      const lines = data.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        try {
          const eventData = JSON.parse(line) as any;

          // Check for start_server tool call (Phase 1 only)
          if (
            phase === 1 &&
            eventData.type === "tool_use" &&
            eventData.tool === "start_server"
          ) {
            const toolUseId = eventData.tool_use_id || "";
            startServerToolIds.add(toolUseId);
            await publishAndStream({
              type: "phase_status",
              phase: 1,
              status: "server_ready",
              message:
                "Agent has called start_server. Server is ready for Phase 2...",
            });
          }

          // Check if tool_result is for start_server
          if (
            phase === 1 &&
            eventData.type === "tool_result" &&
            eventData.tool_use_id &&
            startServerToolIds.has(eventData.tool_use_id)
          ) {
            serverReadyCalled = true;
            agentCompleted = true;
            await publishAndStream({
              type: "phase_status",
              phase: 1,
              status: "complete",
              message:
                "Server ready confirmed. Stopping Phase 1 and proceeding to Phase 2...",
            });
            // Note: We can't break here as we're in a callback, but we'll check serverReadyCalled after
          }

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
          console.log(`Agent Phase ${phase} output:`, line);
        }
      }
    },
    onStderr: (data) => {
      console.error(`Agent Phase ${phase} stderr:`, data);
    },
  });

  if (result.exitCode !== 0 && result.exitCode !== null) {
    console.error(`Agent Phase ${phase} exited with code ${result.exitCode}`);
    await publishAndStream({
      type: "phase_status",
      phase,
      status: "error",
      message: `Phase ${phase} failed with exit code ${result.exitCode}`,
    });
    return { completed: false, serverReady: false };
  }

  // For Phase 1, serverReady is the key indicator
  if (phase === 1) {
    if (serverReadyCalled) {
      await publishAndStream({
        type: "phase_status",
        phase,
        status: "complete",
        message: `Phase ${phase} completed - server ready for testing`,
      });
      console.log(`✅ Phase ${phase} completed - server ready`);
      return { completed: true, serverReady: true };
    } else {
      await publishAndStream({
        type: "phase_status",
        phase,
        status: "incomplete",
        message: `Phase ${phase} finished, but start_server was not called. Server may not be ready.`,
      });
      console.log(`⚠️ Phase ${phase} finished without start_server call`);
      return { completed: agentCompleted, serverReady: false };
    }
  }

  // For Phase 2, just check completion
  if (!agentCompleted) {
    await publishAndStream({
      type: "phase_status",
      phase,
      status: "warning",
      message: `Phase ${phase} finished, but no explicit completion signal detected.`,
    });
    console.log(
      `⚠️ Phase ${phase} finished without explicit completion signal`
    );
    return { completed: false, serverReady: false };
  }

  await publishAndStream({
    type: "phase_status",
    phase,
    status: "complete",
    message: `Phase ${phase} completed successfully`,
  });

  console.log(`✅ Phase ${phase} completed successfully`);
  return { completed: true, serverReady: true };
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
          };
          conversationSandboxes.set(conversationId, sandboxInfo);

          await publishAndStream({
            type: "sandbox_status",
            status: "ready",
            sandboxId: sandbox.sandboxId,
            message: "Sandbox ready with mcp_project (apps-sdk template)",
          });
        }

        const { sandbox, phase } = sandboxInfo;

        // Get last user message
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role !== "user") {
          throw new Error("Last message must be from user");
        }

        const userPrompt = lastMessage.content;

        // Phase 1: Build MCP Server
        if (phase === 1) {
          const phase1Result = await runAgentPhase(
            sandbox,
            userPrompt,
            1,
            publishAndStream
          );

          // Only proceed to Phase 2 if agent called start_server
          if (!phase1Result.serverReady) {
            await publishAndStream({
              type: "phase_status",
              phase: 1,
              status: "waiting",
              message:
                "Waiting for agent to call start_server tool when ready...",
            });
            sandboxInfo.phase = "complete";
            return;
          }

          // After Phase 1, start MCP server
          try {
            const mcpPort = await startMcpServer(sandbox, publishAndStream);
            sandboxInfo.mcpServerPort = mcpPort;
            sandboxInfo.mcpServerRunning = true;
            sandboxInfo.phase = 2;

            await publishAndStream({
              type: "transition",
              from: 1,
              to: 2,
              message: "Transitioning to Phase 2: Testing with MCP connector",
            });

            // Phase 2: Test with MCP Connector
            const testPrompt =
              "Test the MCP server by calling its tools. Verify all functionality works as expected.";
            await runAgentPhase(
              sandbox,
              testPrompt,
              2,
              publishAndStream,
              mcpPort
            );

            sandboxInfo.phase = "complete";
          } catch (mcpError: any) {
            console.error("MCP server start failed:", mcpError);
            await publishAndStream({
              type: "mcp_status",
              status: "error",
              error: mcpError.message,
              message: "MCP server failed to start. Skipping Phase 2 testing.",
            });
            sandboxInfo.phase = "complete";
          }
        } else if (phase === 2) {
          // Continue Phase 2 testing
          const phase2Result = await runAgentPhase(
            sandbox,
            userPrompt,
            2,
            publishAndStream,
            sandboxInfo.mcpServerPort
          );
          if (phase2Result.completed) {
            sandboxInfo.phase = "complete";
          }
        } else if (phase === "complete") {
          // Phase is complete - check if we should restart Phase 1 or continue Phase 2
          if (sandboxInfo.mcpServerRunning && sandboxInfo.mcpServerPort) {
            // MCP server is running, continue with Phase 2 testing
            await runAgentPhase(
              sandbox,
              userPrompt,
              2,
              publishAndStream,
              sandboxInfo.mcpServerPort
            );
          } else {
            // No MCP server running - restart Phase 1
            sandboxInfo.phase = 1;
            const phase1Result = await runAgentPhase(
              sandbox,
              userPrompt,
              1,
              publishAndStream
            );

            // Only proceed to Phase 2 if agent called start_server
            if (phase1Result.serverReady) {
              try {
                const mcpPort = await startMcpServer(sandbox, publishAndStream);
                sandboxInfo.mcpServerPort = mcpPort;
                sandboxInfo.mcpServerRunning = true;
                sandboxInfo.phase = 2;

                await publishAndStream({
                  type: "transition",
                  from: 1,
                  to: 2,
                  message:
                    "Transitioning to Phase 2: Testing with MCP connector",
                });

                const testPrompt =
                  "Test the MCP server by calling its tools. Verify all functionality works as expected.";
                await runAgentPhase(
                  sandbox,
                  testPrompt,
                  2,
                  publishAndStream,
                  mcpPort
                );

                sandboxInfo.phase = "complete";
              } catch (mcpError: any) {
                console.error("MCP server start failed:", mcpError);
                await publishAndStream({
                  type: "mcp_status",
                  status: "error",
                  error: mcpError.message,
                  message:
                    "MCP server failed to start. Skipping Phase 2 testing.",
                });
                sandboxInfo.phase = "complete";
              }
            } else {
              // Phase 1 didn't complete, stay in Phase 1
              sandboxInfo.phase = 1;
            }
          }
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
