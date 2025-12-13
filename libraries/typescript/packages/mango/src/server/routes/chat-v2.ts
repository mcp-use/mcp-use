/**
 * Chat API v2 - Proxy Architecture
 *
 * Architecture:
 * 1. User sends chat request to this endpoint
 * 2. We forward request to Agent SDK running INSIDE E2B sandbox
 * 3. Sandbox agent uses ANTHROPIC_BASE_URL pointing to our proxy
 * 4. Our proxy injects API key before forwarding to Anthropic
 * 5. Stream events from sandbox back to client
 *
 * Security:
 * - API keys never enter the sandbox
 * - Agent is fully isolated in E2B
 * - All Anthropic requests go through our proxy for auditing
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Sandbox } from "@e2b/code-interpreter";

export const chatRoutesV2 = new Hono();

// Store active E2B sandboxes per conversation
const conversationSandboxes = new Map<
  string,
  { sandbox: Sandbox; agentReady: boolean }
>();

// Agent runner script - outputs JSON events to stdout for streaming
// This is simpler and more reliable than running an HTTP server in the sandbox
const AGENT_RUNNER_SCRIPT = `
import { query } from "@anthropic-ai/claude-agent-sdk";

const SYSTEM_PROMPT = \`You are an MCP server development and testing agent.

You are running inside an isolated E2B sandbox with full access to:
- Bash commands (npm, node, git, etc.)
- File read/write operations  
- The /home/user/mcp-project directory with a pre-scaffolded MCP server

WORKFLOW:
1. First, explore the project structure with ls and read files
2. Understand the user's requirements
3. Implement the MCP server in src/index.ts
4. Install any needed dependencies with npm install
5. Test with: npm run build && npm start
6. Iterate until working

RULES:
- Be thorough but concise
- Show your work by reading files before editing
- Test your changes
- Report errors clearly

Your goal: Build a working MCP server that meets all user requirements.\`;

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
    
    for await (const event of query({
      prompt,
      options: {
        model: "claude-sonnet-4-20250514",
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 50,
        permissionMode: "acceptEdits",
      }
    })) {
      if (event.type === "assistant") {
        emit({ type: "assistant", message: event.message });
        // Extract todos
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "tool_use" && block.name === "TodoWrite") {
              emit({ type: "todo_update", todos: block.input?.todos || [] });
            }
          }
        }
      } else if (event.type === "stream_event") {
        emit({ type: "stream_event", event: event.event });
      } else if (event.type === "tool_result") {
        emit({ type: "tool_result", tool_use_id: event.tool_use_id });
      } else if (event.type === "result") {
        emit({ type: "result", subtype: event.subtype });
      }
    }
    emit({ type: "done" });
  } catch (error) {
    emit({ type: "error", error: error.message });
    process.exit(1);
  }
}

run();
`;

// Note: initializeAgentRunner is removed - everything is pre-installed in the E2B template
// The template is created by running e2b-template/setup.sh in an E2B sandbox

/**
 * POST /api/chat/v2/stream
 * Stream chat by forwarding to agent in E2B sandbox
 */
chatRoutesV2.post("/stream", async (c) => {
  try {
    const { messages, conversationId } = await c.req.json();

    if (!messages || !Array.isArray(messages)) {
      return c.json({ error: "Invalid messages format" }, 400);
    }

    const e2bApiKey = process.env.E2B_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const e2bTemplateId = process.env.E2B_TEMPLATE_ID || "base"; // Use base template

    if (!e2bApiKey || !anthropicApiKey) {
      return c.json(
        { error: "E2B_API_KEY or ANTHROPIC_API_KEY not configured" },
        500
      );
    }

    // Determine API server URL for the proxy
    // IMPORTANT: For the proxy to work, the API server must be accessible from the internet
    // Options:
    // 1. Set MANGO_PUBLIC_URL env var (e.g., "https://your-app.railway.app")
    // 2. Use ngrok for local dev: ngrok http 5176
    // 3. Deploy to a public URL
    const publicUrl = process.env.MANGO_PUBLIC_URL;
    if (!publicUrl) {
      console.warn(
        "⚠️ MANGO_PUBLIC_URL not set - sandbox won't be able to reach proxy"
      );
      console.warn("   For local dev, use: ngrok http 5176");
      console.warn(
        "   Then set: MANGO_PUBLIC_URL=https://your-ngrok-url.ngrok.io"
      );
    }
    const apiServerUrl = publicUrl || `http://localhost:5176`;

    return streamSSE(c, async (stream) => {
      let sandboxInfo = conversationSandboxes.get(conversationId);

      try {
        // Get or create E2B sandbox
        if (!sandboxInfo) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "sandbox_status",
              status: "creating",
              message: "Creating E2B sandbox...",
            }),
          });

          console.log(
            `🚀 Creating E2B sandbox for conversation ${conversationId}...`
          );

          const sandbox = await Sandbox.create(e2bTemplateId, {
            apiKey: e2bApiKey,
            envs: {
              MANGO_PUBLIC_URL: apiServerUrl,
            },
            timeoutMs: 600000, // 10 minutes
          });

          console.log(`✅ Sandbox created: ${sandbox.sandboxId}`);

          sandboxInfo = { sandbox, agentReady: false };
          conversationSandboxes.set(conversationId, sandboxInfo);

          sandboxInfo.agentReady = true;

          await stream.writeSSE({
            data: JSON.stringify({
              type: "sandbox_status",
              status: "ready",
              sandboxId: sandbox.sandboxId,
              message: "Agent ready (template pre-configured)",
            }),
          });
        }

        const { sandbox } = sandboxInfo;

        // Get last user message
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role !== "user") {
          throw new Error("Last message must be from user");
        }

        // Run agent with the prompt - stream stdout
        console.log("📤 Running agent in sandbox...");

        // Escape the prompt for shell
        const escapedPrompt = lastMessage.content
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\$/g, "\\$")
          .replace(/`/g, "\\`");

        // Run agent with ANTHROPIC_BASE_URL pointing to our proxy
        const runCmd = `cd /home/user/agent-runner && ANTHROPIC_BASE_URL="${apiServerUrl}/api/anthropic-proxy" npx tsx index.ts "${escapedPrompt}"`;

        // Stream response from sandbox via stdout
        const result = await sandbox.commands.run(runCmd, {
          timeoutMs: 300000, // 5 minutes for long operations
          onStdout: async (data) => {
            // Each line should be a JSON event
            const lines = data.split("\n").filter((line) => line.trim());
            for (const line of lines) {
              try {
                const eventData = JSON.parse(line);
                await stream.writeSSE({ data: JSON.stringify(eventData) });
              } catch {
                // Not JSON, log it
                console.log("Agent output:", line);
              }
            }
          },
          onStderr: (data) => {
            console.error("Agent stderr:", data);
          },
        });

        if (result.exitCode !== 0 && result.exitCode !== null) {
          console.error(`Agent exited with code ${result.exitCode}`);
          // Don't throw - we may have already sent events
        }

        // Send completion
        await stream.writeSSE({
          data: JSON.stringify({ type: "stream_complete" }),
        });

        console.log("✅ Chat completed");
      } catch (error: any) {
        console.error("Chat error:", error);

        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            error: error.message,
          }),
        });

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
 * POST /api/chat/v2/cleanup
 * Clean up a conversation sandbox
 */
chatRoutesV2.post("/cleanup", async (c) => {
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
