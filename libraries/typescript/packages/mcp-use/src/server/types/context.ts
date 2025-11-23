import type {
  CreateMessageRequestParams,
  CreateMessageResult,
  ErrorData,
} from "../../types/sampling.js";

/**
 * Context object passed to tool callbacks
 * Provides access to server capabilities like sampling
 */
export interface ToolContext {
  /**
   * Request sampling (LLM generation) from the client
   * 
   * This method sends a `sampling/createMessage` request to the client.
   * The client will handle this request using its sampling callback if configured.
   * 
   * @param params - Sampling request parameters
   * @returns The generated message result or error data
   * 
   * @example
   * ```typescript
   * server.tool({
   *   name: 'analyze_sentiment',
   *   description: 'Analyze text sentiment',
   *   cb: async (params, ctx) => {
   *     const prompt = `Analyze sentiment: ${params.text}`;
   *     const result = await ctx.sample({
   *       messages: [{ role: 'user', content: { type: 'text', text: prompt } }]
   *     });
   *     if ('code' in result) {
   *       throw new Error(result.message);
   *     }
   *     return { content: [{ type: 'text', text: result.content.text }] };
   *   }
   * });
   * ```
   */
  sample(
    params: CreateMessageRequestParams
  ): Promise<CreateMessageResult | ErrorData>;
}

