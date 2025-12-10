/**
 * MangoAgent - AI agent specialized in creating and editing MCP servers
 */

import type { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ToolMessage } from "langchain";
import {
  AIMessage,
  createAgent,
  HumanMessage,
  SystemMessage,
  type ReactAgent,
  type DynamicTool,
} from "langchain";
import type { WorkspaceManager } from "../server/workspace.js";
import { MANGO_SYSTEM_PROMPT } from "./prompts.js";
import { CreateServerTool } from "./tools/create-server.js";
import {
  ListFilesTool,
  ReadFileTool,
  WriteFileTool,
} from "./tools/file-operations.js";
import {
  InstallDependenciesTool,
  StartServerTool,
  StopServerTool,
} from "./tools/server-lifecycle.js";
import { ListServerToolsTool, TestToolTool } from "./tools/test-tool.js";

export interface MangoAgentConfig {
  llm: BaseLanguageModelInterface;
  workspaceManager: WorkspaceManager;
  additionalTools?: StructuredToolInterface[];
  systemPrompt?: string;
  maxSteps?: number;
  verbose?: boolean;
}

/**
 * MangoAgent - Specialized agent for MCP server development
 */
export class MangoAgent {
  private agent: ReactAgent | null = null;
  private workspaceManager: WorkspaceManager;
  private llm: BaseLanguageModelInterface;
  private tools: StructuredToolInterface[];
  private systemPrompt: string;
  private maxSteps: number;
  private conversationHistory: Array<
    SystemMessage | HumanMessage | AIMessage | ToolMessage
  > = [];
  private initialized = false;

  constructor(config: MangoAgentConfig) {
    this.workspaceManager = config.workspaceManager;
    this.llm = config.llm;
    this.systemPrompt = config.systemPrompt || MANGO_SYSTEM_PROMPT;
    this.maxSteps = config.maxSteps || 10;

    // Create Mango-specific tools
    this.tools = [
      // Server creation
      new CreateServerTool(this.workspaceManager),

      // File operations
      new ReadFileTool(this.workspaceManager),
      new WriteFileTool(this.workspaceManager),
      new ListFilesTool(this.workspaceManager),

      // Dependency management
      new InstallDependenciesTool(this.workspaceManager),

      // Server lifecycle
      new StartServerTool(this.workspaceManager),
      new StopServerTool(),

      // Testing
      new TestToolTool(),
      new ListServerToolsTool(),

      // Add any additional tools
      ...(config.additionalTools || []),
    ];
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create the agent with LangChain's createAgent
    this.agent = createAgent({
      model: this.llm,
      tools: this.tools as DynamicTool[],
      systemPrompt: this.systemPrompt,
    });

    // Initialize conversation history with system message
    this.conversationHistory = [new SystemMessage(this.systemPrompt)];
    this.initialized = true;
  }

  /**
   * Run the agent with a user query
   */
  async run(query: string): Promise<string> {
    if (!this.initialized || !this.agent) {
      await this.initialize();
    }

    // Add user message to history
    const userMessage = new HumanMessage(query);
    this.conversationHistory.push(userMessage);

    // Run the agent
    const result = await this.agent.invoke({
      messages: this.conversationHistory,
    });

    // Extract final response
    let finalResponse = "";
    if (result.messages && Array.isArray(result.messages)) {
      for (const msg of result.messages) {
        if (msg instanceof AIMessage && !msg.tool_calls?.length) {
          finalResponse = typeof msg.content === "string" ? msg.content : "";
        }
      }
      // Update conversation history with all messages
      this.conversationHistory.push(...result.messages);
    }

    return finalResponse || "No response generated";
  }

  /**
   * Stream agent execution
   */
  async *stream(query: string): AsyncGenerator<any, string, void> {
    if (!this.initialized || !this.agent) {
      await this.initialize();
    }

    // Add user message to history
    const userMessage = new HumanMessage(query);
    this.conversationHistory.push(userMessage);

    let finalResponse = "";

    // Stream the agent execution
    const stream = await this.agent.stream({
      messages: this.conversationHistory,
    });

    for await (const chunk of stream) {
      // Yield each step
      yield chunk;

      // Collect messages for history
      if (chunk.messages && Array.isArray(chunk.messages)) {
        for (const msg of chunk.messages) {
          if (msg instanceof AIMessage && !msg.tool_calls?.length) {
            finalResponse = typeof msg.content === "string" ? msg.content : "";
          }
          this.conversationHistory.push(msg);
        }
      }
    }

    return finalResponse || "No response generated";
  }

  /**
   * Stream agent events (for fine-grained progress tracking)
   */
  async *streamEvents(query: string): AsyncGenerator<any, void, void> {
    // For now, just delegate to stream
    for await (const chunk of this.stream(query)) {
      yield chunk;
    }
  }

  /**
   * Get conversation history
   */
  getConversationHistory() {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history
   */
  clearConversationHistory(): void {
    this.conversationHistory = [new SystemMessage(this.systemPrompt)];
  }

  /**
   * Close the agent and clean up resources
   */
  async close(): Promise<void> {
    this.agent = null;
    this.initialized = false;
  }

  /**
   * Get workspace manager
   */
  getWorkspaceManager(): WorkspaceManager {
    return this.workspaceManager;
  }
}
