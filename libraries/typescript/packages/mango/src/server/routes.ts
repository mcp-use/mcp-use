/**
 * Hono routes for Mango API
 */

import type { Hono } from "hono";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MangoAgent } from "../agent/mango-agent.js";
import { MANGO_GREETING } from "../agent/prompts.js";
import type { MangoConfig } from "../types.js";
import { WorkspaceManager } from "./workspace.js";
import { ProcessManager } from "./process-manager.js";

export interface MangoRoutesConfig extends MangoConfig {
  basePath?: string;
}

/**
 * Register Mango routes on a Hono app
 */
export function registerMangoRoutes(
  app: Hono,
  config: MangoRoutesConfig = {}
): void {
  const basePath = config.basePath || "/mango";
  const workspaceManager = new WorkspaceManager({
    workspaceDir: config.workspaceDir,
  });
  const processManager = ProcessManager.getInstance();

  // Health check
  app.get(`${basePath}/health`, (c) => {
    return c.json({
      status: "ok",
      workspace: workspaceManager.getWorkspaceDir(),
      runningServers: processManager.getRunningServers().length,
    });
  });

  // Get workspace info
  app.get(`${basePath}/workspace`, (c) => {
    return c.json({
      workspaceDir: workspaceManager.getWorkspaceDir(),
      projects: workspaceManager.listProjects(),
    });
  });

  // List projects
  app.get(`${basePath}/workspace/projects`, (c) => {
    const projects = workspaceManager.listProjects();
    return c.json({ projects });
  });

  // Get project details
  app.get(`${basePath}/workspace/projects/:name`, (c) => {
    const name = c.req.param("name");
    const project = workspaceManager.getProjectInfo(name);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json(project);
  });

  // List running servers
  app.get(`${basePath}/servers`, (c) => {
    const servers = processManager.getRunningServers();
    return c.json({ servers });
  });

  // Get server status
  app.get(`${basePath}/servers/:name`, (c) => {
    const name = c.req.param("name");
    const server = processManager.getServerInfo(name);

    if (!server) {
      return c.json(
        {
          running: false,
          message: `Server "${name}" is not running`,
        },
        404
      );
    }

    return c.json({
      running: true,
      server,
    });
  });

  // Streaming chat endpoint
  app.post(`${basePath}/chat/stream`, async (c) => {
    try {
      const body = await c.req.json();
      const {
        message,
        provider = "openai",
        apiKey,
        model,
        conversationHistory = [],
      } = body;

      if (!message) {
        return c.json({ error: "Message is required" }, 400);
      }

      if (!apiKey) {
        return c.json({ error: "API key is required" }, 400);
      }

      // Create LLM based on provider
      let llm;
      switch (provider) {
        case "openai":
          llm = new ChatOpenAI({
            apiKey,
            model: model || "gpt-4o",
            temperature: 0.7,
          });
          break;
        case "anthropic":
          llm = new ChatAnthropic({
            apiKey,
            model: model || "claude-3-5-sonnet-20241022",
            temperature: 0.7,
          });
          break;
        case "google":
          llm = new ChatGoogleGenerativeAI({
            apiKey,
            model: model || "gemini-2.0-flash-exp",
            temperature: 0.7,
          });
          break;
        default:
          return c.json({ error: `Unsupported provider: ${provider}` }, 400);
      }

      // Create Mango agent
      const agent = new MangoAgent({
        llm,
        workspaceManager,
        maxSteps: 15,
        verbose: true,
      });

      await agent.initialize();

      // Restore conversation history if provided
      if (conversationHistory.length > 0) {
        // TODO: Implement history restoration
        // For now, we'll start fresh each time
      }

      // Create a readable stream
      const { readable, writable } = new globalThis.TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Start streaming in the background
      (async () => {
        try {
          // Send initial greeting if this is the first message
          if (conversationHistory.length === 0) {
            await writer.write(
              encoder.encode(
                JSON.stringify({
                  type: "greeting",
                  content: MANGO_GREETING,
                }) + "\n"
              )
            );
          }

          // Stream agent steps
          for await (const step of agent.stream(message)) {
            await writer.write(
              encoder.encode(
                JSON.stringify({
                  type: "step",
                  data: step,
                }) + "\n"
              )
            );
          }

          // Send completion
          await writer.write(
            encoder.encode(
              JSON.stringify({
                type: "complete",
              }) + "\n"
            )
          );
        } catch (error) {
          const errorMsg =
            JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Unknown error",
            }) + "\n";
          await writer.write(encoder.encode(errorMsg));
        } finally {
          await agent.close();
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      console.error("[Mango] Chat stream error:", error);
      return c.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  });

  // Non-streaming chat endpoint (for simpler clients)
  app.post(`${basePath}/chat`, async (c) => {
    try {
      const body = await c.req.json();
      const { message, provider = "openai", apiKey, model } = body;

      if (!message) {
        return c.json({ error: "Message is required" }, 400);
      }

      if (!apiKey) {
        return c.json({ error: "API key is required" }, 400);
      }

      // Create LLM based on provider
      let llm;
      switch (provider) {
        case "openai":
          llm = new ChatOpenAI({
            apiKey,
            model: model || "gpt-4o",
            temperature: 0.7,
          });
          break;
        case "anthropic":
          llm = new ChatAnthropic({
            apiKey,
            model: model || "claude-3-5-sonnet-20241022",
            temperature: 0.7,
          });
          break;
        case "google":
          llm = new ChatGoogleGenerativeAI({
            apiKey,
            model: model || "gemini-2.0-flash-exp",
            temperature: 0.7,
          });
          break;
        default:
          return c.json({ error: `Unsupported provider: ${provider}` }, 400);
      }

      // Create Mango agent
      const agent = new MangoAgent({
        llm,
        workspaceManager,
        maxSteps: 15,
        verbose: true,
      });

      await agent.initialize();

      // Run agent and get result
      const result = await agent.run(message);

      // Clean up
      await agent.close();

      return c.json({
        response: result,
        conversationHistory: agent.getConversationHistory(),
      });
    } catch (error) {
      console.error("[Mango] Chat error:", error);
      return c.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  });

  console.log(`[Mango] Routes registered at ${basePath}`);
}
