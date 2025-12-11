import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createMangoAgent } from "../../agent/mango-agent.js";

export const chatRoutes = new Hono();

/**
 * POST /api/chat/stream
 * Stream chat messages with Mango agent using Claude
 */
chatRoutes.post("/stream", async (c) => {
  try {
    const { messages, workspaceDir } = await c.req.json();

    if (!messages || !Array.isArray(messages)) {
      return c.json({ error: "Invalid messages format" }, 400);
    }

    // Support both ANTHROPIC_API_KEY and OPENAI_API_KEY
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return c.json(
        { error: "ANTHROPIC_API_KEY or OPENAI_API_KEY not configured" },
        500
      );
    }

    // Create Mango agent
    const agent = createMangoAgent({ workspaceDir, apiKey });

    // Initialize Anthropic client
    const anthropic = new Anthropic({ apiKey });

    // Stream the response with multi-turn tool execution
    return streamSSE(c, async (stream) => {
      try {
        // Convert messages to Claude format
        const conversationMessages = messages.map((msg: any) => ({
          role: (msg.role === "user" ? "user" : "assistant") as
            | "user"
            | "assistant",
          content: msg.content,
        }));

        let continueConversation = true;
        let turnCount = 0;
        const maxTurns = 10; // Prevent infinite loops

        while (continueConversation && turnCount < maxTurns) {
          turnCount++;

          // Create the stream with tools and extended thinking
          const messageStream = await anthropic.messages.create({
            model: agent.getApiConfig().model,
            max_tokens: 8096,
            system: agent.getSystemPrompt(),
            messages: conversationMessages,
            tools: agent.getTools(),
            thinking: {
              type: "enabled",
              budget_tokens: 2000,
            },
            stream: true,
          });

          let currentToolUse: any = null;
          let currentToolInput = "";
          const assistantContent: any[] = [];
          let toolsUsedInThisTurn = false;

          // Stream events
          for await (const event of messageStream) {
            // Send event to client
            await stream.writeSSE({
              data: JSON.stringify(event),
            });

            // Track assistant content for multi-turn
            if (event.type === "content_block_start") {
              const block = (event as any).content_block;
              if (block?.type === "tool_use") {
                currentToolUse = block;
                currentToolInput = "";
                assistantContent.push({
                  type: "tool_use",
                  id: block.id,
                  name: block.name,
                  input: {},
                });
                toolsUsedInThisTurn = true;
              } else if (block?.type === "text") {
                assistantContent.push({ type: "text", text: "" });
              } else if (block?.type === "thinking") {
                assistantContent.push({
                  type: "thinking",
                  thinking: block.thinking || "",
                  signature: block.signature || "",
                });
              }
            } else if (event.type === "content_block_delta") {
              const delta = (event as any).delta;
              if (delta?.type === "input_json_delta" && currentToolUse) {
                currentToolInput += delta.partial_json;
              } else if (delta?.type === "text_delta") {
                const lastBlock = assistantContent[assistantContent.length - 1];
                if (lastBlock?.type === "text") {
                  lastBlock.text += delta.text;
                }
              } else if (delta?.type === "thinking_delta") {
                const lastBlock = assistantContent[assistantContent.length - 1];
                if (lastBlock?.type === "thinking") {
                  lastBlock.thinking += delta.thinking;
                }
              } else if (delta?.type === "signature_delta") {
                const lastBlock = assistantContent[assistantContent.length - 1];
                if (lastBlock?.type === "thinking") {
                  lastBlock.signature =
                    (lastBlock.signature || "") + delta.signature;
                }
              }
            } else if (event.type === "content_block_stop" && currentToolUse) {
              // Update tool input with final parsed value
              try {
                const toolInput = JSON.parse(currentToolInput);
                const lastToolBlock = assistantContent.find(
                  (c) => c.type === "tool_use" && c.id === currentToolUse.id
                );
                if (lastToolBlock) {
                  lastToolBlock.input = toolInput;
                }
              } catch (e) {
                // Keep empty input
              }
            }

            // Execute tool after content block stop
            if (event.type === "content_block_stop" && currentToolUse) {
              // Execute the tool with progress streaming
              try {
                const toolInput = JSON.parse(currentToolInput);

                // Progress callback for streaming tool output
                const onProgress = async (message: string) => {
                  await stream.writeSSE({
                    data: JSON.stringify({
                      type: "tool_progress",
                      tool_use_id: currentToolUse.id,
                      tool_name: currentToolUse.name,
                      message,
                    }),
                  });
                };

                // Execute tool with progress callback
                let toolResult;
                if (currentToolUse.name === "create_server") {
                  const { createServerTool } =
                    await import("../../agent/tools/create-server.js");
                  toolResult = await createServerTool(
                    toolInput,
                    agent["context"],
                    onProgress
                  );
                } else if (currentToolUse.name === "install_deps") {
                  const { installDepsTool } =
                    await import("../../agent/tools/install-deps.js");
                  toolResult = await installDepsTool(
                    toolInput,
                    agent["context"],
                    onProgress
                  );
                } else if (currentToolUse.name === "start_server") {
                  const { startServerTool } =
                    await import("../../agent/tools/start-server.js");
                  toolResult = await startServerTool(
                    toolInput,
                    agent["context"],
                    onProgress
                  );
                } else {
                  toolResult = await agent.executeTool(
                    currentToolUse.name,
                    toolInput
                  );
                }

                // Send tool result to client
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "tool_result",
                    tool_use_id: currentToolUse.id,
                    tool_name: currentToolUse.name,
                    result: toolResult,
                  }),
                });

                // Add tool result to conversation for next turn
                assistantContent.push({
                  type: "tool_result",
                  tool_use_id: currentToolUse.id,
                  content: toolResult.success
                    ? `Tool executed successfully: ${toolResult.message || JSON.stringify(toolResult.data)}`
                    : `Tool failed: ${toolResult.error}`,
                });

                currentToolUse = null;
                currentToolInput = "";
              } catch (error: any) {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "tool_error",
                    tool_use_id: currentToolUse.id,
                    error: error.message,
                  }),
                });

                assistantContent.push({
                  type: "tool_result",
                  tool_use_id: currentToolUse.id,
                  content: `Tool error: ${error.message}`,
                  is_error: true,
                });
              }
            }
          }

          // If tools were used, continue the conversation
          if (toolsUsedInThisTurn) {
            // Add assistant message - must start with thinking when enabled
            // Include thinking blocks, text, and tool_use, but NOT tool_result
            const assistantBlocks = assistantContent.filter(
              (c) => c.type !== "tool_result"
            );

            // Ensure thinking block is first if it exists
            const thinkingBlocks = assistantBlocks.filter(
              (c) => c.type === "thinking"
            );
            const otherBlocks = assistantBlocks.filter(
              (c) => c.type !== "thinking"
            );

            conversationMessages.push({
              role: "assistant",
              content: [...thinkingBlocks, ...otherBlocks],
            });

            // Add user message with tool results only
            const toolResults = assistantContent.filter(
              (c) => c.type === "tool_result"
            );
            if (toolResults.length > 0) {
              conversationMessages.push({
                role: "user",
                content: toolResults,
              });
            }

            // Send turn continuation event
            await stream.writeSSE({
              data: JSON.stringify({
                type: "turn_complete",
                turn: turnCount,
                continuing: true,
              }),
            });
          } else {
            // No tools used, conversation is complete
            continueConversation = false;
          }
        }

        // Send completion event
        await stream.writeSSE({
          data: JSON.stringify({
            type: "stream_complete",
            total_turns: turnCount,
          }),
        });
      } catch (error: any) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            error: error.message,
          }),
        });
      }
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chat/message
 * Non-streaming chat endpoint
 */
chatRoutes.post("/message", async (c) => {
  try {
    const { messages, workspaceDir } = await c.req.json();

    if (!messages || !Array.isArray(messages)) {
      return c.json({ error: "Invalid messages format" }, 400);
    }

    // Support both ANTHROPIC_API_KEY and OPENAI_API_KEY
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return c.json(
        { error: "ANTHROPIC_API_KEY or OPENAI_API_KEY not configured" },
        500
      );
    }

    const agent = createMangoAgent({ workspaceDir, apiKey });
    const anthropic = new Anthropic({ apiKey });

    const claudeMessages = messages.map((msg: any) => ({
      role: (msg.role === "user" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: msg.content,
    }));

    const response = await anthropic.messages.create({
      model: agent.getApiConfig().model,
      max_tokens: 8096,
      system: agent.getSystemPrompt(),
      messages: claudeMessages,
      tools: agent.getTools(),
    });

    return c.json({
      role: "assistant",
      content: response.content,
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    return c.json({ error: error.message }, 500);
  }
});
