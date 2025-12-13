/**
 * E2B Sandbox Manager
 * Manages E2B sandbox lifecycle and proxies messages to/from agent running in sandbox
 */
import { Sandbox } from "@e2b/code-interpreter";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";

export interface SandboxConfig {
  apiKey: string;
  templateId: string;
  anthropicApiKey: string;
  infisicalProjectId: string;
}

export interface AgentEvent {
  type: string;
  [key: string]: any;
}

export interface SandboxSession {
  id: string;
  sandbox: Sandbox;
  agentReady: boolean;
  mcpServerRunning: boolean;
  mcpServerUrl?: string;
}

/**
 * Manages E2B sandboxes with Agent SDK v2 runtime
 */
export class E2BManager extends EventEmitter {
  private config: SandboxConfig;
  private activeSessions: Map<string, SandboxSession> = new Map();

  constructor(config: SandboxConfig) {
    super();
    this.config = config;
  }

  /**
   * Create a new E2B sandbox with agent runtime
   */
  async createSandboxWithAgent(): Promise<SandboxSession> {
    const sessionId = nanoid();

    console.log(`🚀 Creating E2B sandbox for session ${sessionId}...`);

    // Create E2B sandbox from template with environment variables
    const sandbox = await Sandbox.create(this.config.templateId, {
      apiKey: this.config.apiKey,
      timeoutMs: 600000, // 10 minutes
      envs: {
        ANTHROPIC_API_KEY: this.config.anthropicApiKey,
      },
    });

    console.log(`✅ Sandbox created: ${sandbox.sandboxId}`);

    const session: SandboxSession = {
      id: sessionId,
      sandbox,
      agentReady: false,
      mcpServerRunning: false,
    };

    this.activeSessions.set(sessionId, session);

    // Upload agent runtime files to sandbox (ready to execute queries)
    await this.uploadAgentFiles(session);

    return session;
  }

  /**
   * Upload agent runtime files to sandbox
   */
  private async uploadAgentFiles(session: SandboxSession): Promise<void> {
    console.log("📤 Uploading agent runtime files to sandbox...");

    const runtimePath = new URL("../sandbox-agent/runtime.ts", import.meta.url)
      .pathname;
    const systemPromptPath = new URL(
      "../sandbox-agent/system-prompt.ts",
      import.meta.url
    ).pathname;

    const fs = await import("fs/promises");
    const runtimeCode = await fs.readFile(runtimePath, "utf-8");
    const systemPromptCode = await fs.readFile(systemPromptPath, "utf-8");

    // Create directory and upload files
    await session.sandbox.files.write(
      "/home/user/sandbox-agent/runtime.ts",
      runtimeCode
    );
    await session.sandbox.files.write(
      "/home/user/sandbox-agent/system-prompt.ts",
      systemPromptCode
    );

    console.log("✅ Agent runtime files uploaded to sandbox");
    session.agentReady = true;
  }

  /**
   * Handle output from agent runtime
   */
  private handleAgentOutput(session: SandboxSession, data: string): void {
    // Parse JSON events from agent output
    const lines = data.split("\n");

    for (const line of lines) {
      if (!line.trim() || !line.startsWith("{")) continue;

      try {
        const event = JSON.parse(line);

        // Emit event for consumption by chat API
        this.emit(`session:${session.id}:event`, event);

        // Handle special events
        if (event.type === "server_starting") {
          this.handleServerStarting(session, event);
        }
      } catch (error) {
        // Not JSON, ignore
      }
    }
  }

  /**
   * Handle server starting detection
   */
  private async handleServerStarting(
    session: SandboxSession,
    event: any
  ): Promise<void> {
    console.log("🔍 Detecting if MCP server started...");

    // Wait a bit for server to fully start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check if server is running on common ports
    const portsToCheck = [3000, 3001, 8000, 8080];

    for (const port of portsToCheck) {
      try {
        // Try to connect to the port
        const checkCmd = `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/health || echo "000"`;
        const result = await session.sandbox.commands.run(checkCmd);

        if (result.stdout && !result.stdout.includes("000")) {
          console.log(`✅ MCP server detected on port ${port}`);
          session.mcpServerRunning = true;
          session.mcpServerUrl = `http://localhost:${port}`;

          // Inject MCP server tools into agent
          await this.injectMcpServerTools(session);
          break;
        }
      } catch (error) {
        // Port not responding, try next
      }
    }
  }

  /**
   * Dynamically inject MCP server tools into agent session
   */
  async injectMcpServerTools(session: SandboxSession): Promise<void> {
    if (!session.mcpServerUrl) {
      throw new Error("No MCP server URL available");
    }

    console.log(
      `🔌 Injecting MCP server tools from ${session.mcpServerUrl}...`
    );

    // Send message to agent runtime to inject MCP server
    const message = {
      type: "inject_mcp_server",
      serverConfig: {
        type: "http",
        url: session.mcpServerUrl,
      },
    };

    // Write to agent's stdin
    await session.sandbox.commands.run(
      `echo '${JSON.stringify(message)}' | tee /tmp/mcp-inject.json`
    );

    this.emit(`session:${session.id}:event`, {
      type: "mcp_server_ready",
      url: session.mcpServerUrl,
    });
  }

  /**
   * Send a message to the agent in the sandbox
   * Runs a fresh Agent SDK query for each message
   */
  async sendMessageToAgent(
    sessionId: string,
    content: string
  ): Promise<AsyncGenerator<AgentEvent>> {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.agentReady) {
      throw new Error("Agent not ready yet");
    }

    console.log(`📤 Running agent query in sandbox for session ${sessionId}`);

    // Load system prompt
    const fs = await import("fs/promises");
    const systemPromptPath = new URL(
      "../sandbox-agent/system-prompt.ts",
      import.meta.url
    ).pathname;
    const systemPromptFile = await fs.readFile(systemPromptPath, "utf-8");
    const systemPromptMatch = systemPromptFile.match(
      /export const AGENT_SYSTEM_PROMPT = `([^`]+)`/s
    );
    const systemPrompt = systemPromptMatch
      ? systemPromptMatch[1]
      : "You are an MCP server development agent.";

    // Create a script that runs the agent query and outputs JSON events
    const queryScript = `
import { query } from '@anthropic-ai/claude-agent-sdk';

const AGENT_SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)};
const userMessage = ${JSON.stringify(content)};

const queryGenerator = query({
  prompt: userMessage,
  options: {
    model: 'claude-sonnet-4-20250514',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: AGENT_SYSTEM_PROMPT,
    },
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
    permissionMode: 'acceptEdits',
    cwd: '/home/user/mcp-project',
    includePartialMessages: true,  // Enable streaming token by token
  }
});

for await (const msg of queryGenerator) {
  // Force immediate output by writing to stderr which is unbuffered
  if (msg.type === 'stream_event') {
    // Stream partial messages (token by token) to stderr for immediate delivery
    process.stderr.write(JSON.stringify({ type: 'stream_event', event: msg.event }) + '\\n');
  } else {
    // Other messages to stdout
    process.stdout.write(JSON.stringify({ type: 'agent_event', event: msg }) + '\\n');
  }
  
  // Check for server startup
  if (msg.type === 'assistant' && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === 'tool_use' && block.name === 'Bash') {
        const input = block.input;
        const command = input?.command || '';
        if (command.includes('npm start') || command.includes('node ')) {
          process.stdout.write(JSON.stringify({ type: 'server_starting', command }) + '\\n');
        }
      }
    }
  }
}
`;

    // Write the query script in the agent-runtime directory (where node_modules is)
    await session.sandbox.files.write(
      "/home/user/agent-runtime/query.mjs",
      queryScript
    );

    // Execute and stream results
    return this.executeQueryAndStream(session, sessionId);
  }

  /**
   * Execute agent query and stream events
   */
  private async *executeQueryAndStream(
    session: SandboxSession,
    sessionId: string
  ): AsyncGenerator<AgentEvent> {
    // Run from agent-runtime directory so imports work
    // Force unbuffered output with stdbuf
    const execution = session.sandbox.commands.run(
      "cd /home/user/agent-runtime && stdbuf -oL -eL node query.mjs",
      {
        onStdout: (data) => {
          this.handleAgentOutput(session, data);
        },
        onStderr: (data) => {
          // stderr also contains stream_event messages
          this.handleAgentOutput(session, data);
        },
      }
    );

    // Stream events as they arrive
    yield* this.streamEvents(sessionId);

    // Wait for execution to complete
    try {
      await execution;
    } catch (error: any) {
      yield { type: "error", error: error.message };
    }
  }

  /**
   * Stream events from agent
   */
  private async *streamEvents(sessionId: string): AsyncGenerator<AgentEvent> {
    const eventQueue: AgentEvent[] = [];
    let resolveNext: ((value: AgentEvent | null) => void) | null = null;
    let done = false;

    // Set up event listener
    const eventHandler = (event: AgentEvent) => {
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        eventQueue.push(event);
      }

      // Check if conversation is complete
      if (event.type === "agent_event" && event.event?.type === "result") {
        done = true;
        if (resolveNext) {
          resolveNext(null);
          resolveNext = null;
        }
      }
    };

    this.on(`session:${sessionId}:event`, eventHandler);

    try {
      while (!done) {
        let event: AgentEvent | null;

        if (eventQueue.length > 0) {
          event = eventQueue.shift()!;
        } else {
          event = await new Promise<AgentEvent | null>((resolve) => {
            resolveNext = resolve;

            // Timeout after 60 seconds
            setTimeout(() => {
              if (resolveNext === resolve) {
                resolve(null);
                resolveNext = null;
              }
            }, 60000);
          });
        }

        if (event) {
          yield event;
        } else {
          break;
        }
      }
    } finally {
      this.off(`session:${sessionId}:event`, eventHandler);
    }
  }

  /**
   * Clean up a session
   */
  async cleanup(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return;
    }

    console.log(`🧹 Cleaning up session ${sessionId}...`);

    try {
      await session.sandbox.kill();
    } catch (error) {
      console.error("Error killing sandbox:", error);
    }

    this.activeSessions.delete(sessionId);
    console.log("✅ Session cleaned up");
  }

  /**
   * Clean up all sessions
   */
  async cleanupAll(): Promise<void> {
    const sessionIds = Array.from(this.activeSessions.keys());

    await Promise.all(sessionIds.map((id) => this.cleanup(id)));
  }
}
