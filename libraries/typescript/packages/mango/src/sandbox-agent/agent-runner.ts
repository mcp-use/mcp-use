/**
 * Agent Runner - Runs INSIDE the E2B sandbox
 *
 * This script:
 * 1. Starts an HTTP server inside the sandbox
 * 2. Receives chat requests from the API server
 * 3. Runs the Agent SDK with built-in tools (Bash, Read, Write, etc.)
 * 4. Streams events back via SSE (todos, thinking, messages)
 *
 * The ANTHROPIC_BASE_URL points to our proxy, so API key is never in sandbox.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

// System prompt for MCP server development
const SYSTEM_PROMPT = `You are an MCP server development and testing agent.

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
- Ask for clarification if requirements are unclear

Your goal: Build a working MCP server that meets all user requirements.`;

// Type for chat request
interface ChatRequest {
  prompt: string;
  conversationId?: string;
}

// Start HTTP server
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Chat endpoint
    if (url.pathname === "/chat" && req.method === "POST") {
      try {
        const body = (await req.json()) as ChatRequest;
        const { prompt } = body;

        if (!prompt) {
          return new Response(JSON.stringify({ error: "prompt required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        console.log(`📥 Received prompt: ${prompt.substring(0, 100)}...`);

        // Return SSE stream
        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();

              const sendEvent = (data: any) => {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
                );
              };

              try {
                // Run Agent SDK query
                console.log("🤖 Starting Agent SDK query...");

                for await (const event of query({
                  prompt,
                  options: {
                    model: "claude-sonnet-4-20250514",
                    systemPrompt: SYSTEM_PROMPT,
                    maxTurns: 50,
                    permissionMode: "acceptEdits", // Auto-accept in sandbox
                  },
                })) {
                  // Handle different event types
                  if (event.type === "assistant") {
                    // Send assistant message
                    sendEvent({
                      type: "assistant",
                      message: event.message,
                    });

                    // Extract and send todo updates
                    if (event.message?.content) {
                      for (const block of event.message.content) {
                        if (
                          block.type === "tool_use" &&
                          block.name === "TodoWrite"
                        ) {
                          sendEvent({
                            type: "todo_update",
                            todos: (block.input as any)?.todos || [],
                          });
                        }
                      }
                    }
                  } else if (event.type === "tool_result") {
                    sendEvent({
                      type: "tool_result",
                      tool_use_id: event.tool_use_id,
                    });
                  } else if (event.type === "result") {
                    sendEvent({
                      type: "result",
                      subtype: event.subtype,
                    });
                  } else if (event.type === "stream_event") {
                    // Forward raw stream events for token-by-token updates
                    sendEvent({
                      type: "stream_event",
                      event: event.event,
                    });
                  }
                }

                // Signal completion
                sendEvent({ type: "done" });
                console.log("✅ Agent query completed");
              } catch (error: any) {
                console.error(`❌ Agent error: ${error.message}`);
                sendEvent({
                  type: "error",
                  error: error.message,
                });
              } finally {
                controller.close();
              }
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          }
        );
      } catch (error: any) {
        console.error(`❌ Request error: ${error.message}`);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 404 for unknown routes
    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 Agent runner listening on port ${server.port}`);
console.log(
  `📡 ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL || "(not set)"}`
);
