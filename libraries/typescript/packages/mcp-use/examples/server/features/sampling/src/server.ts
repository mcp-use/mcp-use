import { MCPServer, text } from "mcp-use/server";
import z from "zod";

const server = new MCPServer({
  name: "sampling-example-server",
  version: "1.0.0",
  description: "An MCP server example demonstrating sampling capabilities",
});

/**
 * Example 1: Full control API with all options
 * Use this when you need fine-grained control over model preferences, system prompts, etc.
 */
server.tool(
  {
    name: "analyze-sentiment",
    description:
      "Analyze sentiment using full control API with custom model preferences and progress tracking.",
    schema: z.object({
      text: z.string(),
    }),
  },
  async (params, ctx) => {
    const prompt = `Analyze the sentiment of the following text as positive, negative, or neutral. Just output a single word - 'positive', 'negative', or 'neutral'. The text to analyze is: ${params.text}`;

    // Full control API - complete params object
    const result = await ctx.sample(
      {
        messages: [
          {
            role: "user",
            content: { type: "text", text: prompt },
          },
        ],
        modelPreferences: {
          intelligencePriority: 0.8,
          speedPriority: 0.5,
        },
        maxTokens: 100,
      },
      {
        // Optional: custom progress handling
        onProgress: ({ message }) => console.log(`[Progress] ${message}`),
        // Optional: custom progress interval (default: 5000ms)
        // progressIntervalMs: 3000,
        // Optional: timeout (default: no timeout)
        // timeout: 120000, // 2 minutes
      }
    );

    const content = Array.isArray(result.content)
      ? result.content[0]
      : result.content;
    const sentimentText = content?.type === "text" ? content.text : "Unknown";
    return text(`Sentiment: ${sentimentText}`);
  }
);

/**
 * Example 2: Simplified string API - just pass a prompt
 * Perfect for simple cases where you don't need custom model preferences
 */
server.tool(
  {
    name: "analyze-sentiment-simple",
    description:
      "Analyze sentiment using simplified string API (recommended for most cases).",
    schema: z.object({
      text: z.string(),
    }),
  },
  async (params, ctx) => {
    // ✨ New simplified API - just pass a string!
    // Automatically uses sensible defaults: maxTokens=1000, no model preference
    const res = await ctx.sample(
      `Analyze the sentiment of the following text as positive, negative, or neutral. Just output a single word - 'positive', 'negative', or 'neutral'. The text to analyze is: ${params.text}`
    );
    const content = Array.isArray(res.content) ? res.content[0] : res.content;
    const sentimentText = content?.type === "text" ? content.text : "Unknown";
    return text(`Sentiment: ${sentimentText}`);
  }
);

/**
 * Example 3: Simplified API with custom options
 * String prompt + options for when you need some customization
 */
server.tool(
  {
    name: "analyze-sentiment-with-options",
    description:
      "Analyze sentiment using simplified API with custom maxTokens and timeout.",
    schema: z.object({
      text: z.string(),
    }),
  },
  async (params, ctx) => {
    // String prompt with options - best of both worlds!
    const res = await ctx.sample(`Analyze the sentiment: ${params.text}`, {
      maxTokens: 50, // Custom token limit
      temperature: 0.3, // Lower temperature for consistent results
      timeout: 30000, // 30 second timeout
    });
    const content = Array.isArray(res.content) ? res.content[0] : res.content;
    const sentimentText = content?.type === "text" ? content.text : "Unknown";
    return text(`Sentiment: ${sentimentText}`);
  }
);

await server.listen();
