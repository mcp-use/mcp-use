/**
 * Agent SDK runtime that runs inside E2B sandbox using stable V1 API
 * This is the agent that users directly converse with
 *
 * Uses Claude Code with built-in tools: Read, Write, Edit, Bash, Glob, Grep, TodoWrite
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { AGENT_SYSTEM_PROMPT } from "./system-prompt.js";

interface RuntimeConfig {
  model?: string;
}

/**
 * Main runtime loop for the agent in E2B sandbox
 */
export async function runAgentRuntime(config: RuntimeConfig = {}) {
  const { model = "claude-sonnet-4-20250514" } = config;

  console.log("🤖 Starting Agent SDK session in sandbox (V1 stable API)...");
  console.log(
    "✅ Claude Code with built-in tools: Read, Write, Edit, Bash, Glob, Grep, TodoWrite"
  );
  console.log("📡 Ready to receive messages via stdin");

  // Read messages from stdin (sent by E2B manager)
  process.stdin.setEncoding("utf-8");

  let inputBuffer = "";

  process.stdin.on("data", async (chunk) => {
    inputBuffer += chunk;

    // Process complete lines
    const lines = inputBuffer.split("\n");
    inputBuffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);

        if (message.type === "user_message") {
          await handleUserMessage(message.content, model);
        } else if (message.type === "inject_mcp_server") {
          // MCP server injection would require restarting the query with mcpServers option
          console.log(
            JSON.stringify({
              type: "mcp_server_inject_info",
              message: "MCP server tools available via query options",
              config: message.serverConfig,
            })
          );
        }
      } catch (error) {
        console.error("Failed to parse message:", error);
      }
    }
  });

  // Keep process alive
  await new Promise(() => {});
}

/**
 * Handle a user message using V1 query API
 */
async function handleUserMessage(content: string, model: string) {
  try {
    // Create query with stable V1 API
    const queryGenerator = query({
      prompt: content,
      options: {
        model,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: AGENT_SYSTEM_PROMPT,
        },
        allowedTools: [
          "Read",
          "Write",
          "Edit",
          "Bash",
          "Glob",
          "Grep",
          "TodoWrite",
        ],
        permissionMode: "acceptEdits",
        cwd: "/home/user/mcp-project",
      },
    });

    // Stream all messages from the query
    for await (const msg of queryGenerator) {
      // Stream message back to stdout (picked up by E2B manager)
      console.log(
        JSON.stringify({
          type: "agent_event",
          event: msg,
        })
      );

      // Check if MCP server was started (watch for Bash tool usage)
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "tool_use" && block.name === "Bash") {
            const input = block.input as { command?: string };
            const command = input?.command || "";
            if (
              command.includes("npm start") ||
              command.includes("node ") ||
              command.includes("tsx ")
            ) {
              // Notify that server might be starting
              console.log(
                JSON.stringify({
                  type: "server_starting",
                  command,
                })
              );
            }
          }
        }
      }
    }
  } catch (error: any) {
    console.log(
      JSON.stringify({
        type: "error",
        error: error.message,
      })
    );
  }
}

// Start runtime if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAgentRuntime().catch((error) => {
    console.error("Runtime error:", error);
    process.exit(1);
  });
}
