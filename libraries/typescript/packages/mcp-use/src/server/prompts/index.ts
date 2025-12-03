import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import type { PromptDefinition } from "../types.js";

export interface PromptServerContext {
  server: {
    registerPrompt(
      name: string,
      metadata: {
        title?: string;
        description: string;
        argsSchema: any;
      },
      getPromptCallback: (params: any) => Promise<GetPromptResult>
    ): void;
  };
  registeredPrompts: string[];
  createParamsSchema: (args: any[]) => any;
}

/**
 * Define a prompt template
 *
 * Registers a prompt template with the MCP server that clients can use to generate
 * structured prompts for AI models. Prompt templates accept parameters and return
 * formatted text that can be used as input to language models or other AI systems.
 *
 * @param promptDefinition - Configuration object containing prompt metadata and handler function
 * @param promptDefinition.name - Unique identifier for the prompt template
 * @param promptDefinition.description - Human-readable description of the prompt's purpose
 * @param promptDefinition.args - Array of argument definitions with types and validation
 * @param promptDefinition.cb - Async callback function that generates the prompt from provided arguments
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * server.prompt({
 *   name: 'code-review',
 *   description: 'Generates a code review prompt',
 *   args: [
 *     { name: 'language', type: 'string', required: true },
 *     { name: 'focus', type: 'string', required: false }
 *   ],
 *   cb: async ({ language, focus = 'general' }) => {
 *     return {
 *       messages: [{
 *         role: 'user',
 *         content: `Please review this ${language} code with focus on ${focus}...`
 *       }]
 *     }
 *   }
 * })
 * ```
 */
export function registerPrompt(
  this: PromptServerContext,
  promptDefinition: PromptDefinition
): PromptServerContext {
  const argsSchema = this.createParamsSchema(promptDefinition.args || []);
  this.server.registerPrompt(
    promptDefinition.name,
    {
      title: promptDefinition.title,
      description: promptDefinition.description ?? "",
      argsSchema: argsSchema as any, // Type assertion for Zod v4 compatibility
    },
    async (params: any): Promise<GetPromptResult> => {
      return await promptDefinition.cb(params);
    }
  );
  this.registeredPrompts.push(promptDefinition.name);
  return this;
}
