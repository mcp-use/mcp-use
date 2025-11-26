import { createMCPServer, type ToolContext } from "../../../../dist/src/server/index.js";

// Create an MCP server with sampling support
const server = createMCPServer("sampling-example-server", {
  version: "1.0.0",
  description: "An MCP server example demonstrating sampling capabilities",
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

/**
 * Example tool that uses sampling to analyze sentiment.
 * 
 * The ctx.sample() function automatically:
 * - Sends progress notifications every 5 seconds while waiting for the LLM
 * - Has no timeout by default (waits indefinitely)
 * - Resets client-side timeouts when resetTimeoutOnProgress is enabled
 */
server.tool({
  name: "analyze-sentiment",
  description:
    "Analyze the sentiment of text using the client's LLM. Requires a client with sampling support.",
  inputs: [
    {
      name: "text",
      type: "string",
      required: true,
      description: "The text to analyze for sentiment",
    },
  ],
  cb: async (params, ctx?: ToolContext) => {
    if (!ctx) {
      return {
        content: [
          {
            type: "text",
            text: "Error: This tool requires a client with sampling support. Please provide a samplingCallback when initializing the client.",
          },
        ],
        isError: true,
      };
    }

    try {
      // Request LLM analysis through sampling
      // Progress notifications are sent automatically every 5 seconds
      const prompt = `Analyze the sentiment of the following text as positive, negative, or neutral.
Just output a single word - 'positive', 'negative', or 'neutral'.

Text to analyze: ${params.text}`;

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
          onProgress: ({ message }: { progress: number; total?: number; message: string }) =>
            console.log(`[Progress] ${message}`),
          // Optional: custom progress interval (default: 5000ms)
          // progressIntervalMs: 3000,
          // Optional: timeout (default: no timeout)
          // timeout: 120000, // 2 minutes
        }
      );

      // Extract text from result
      const content = Array.isArray(result.content)
        ? result.content[0]
        : result.content;

      return {
        content: [
          {
            type: "text",
            text: `Sentiment Analysis Result: ${content.text || "Unable to analyze sentiment"}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error during sampling: ${error.message || String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
});

/**
 * Example tool that uses sampling for text summarization.
 * Uses default options - no timeout, progress every 5 seconds.
 */
server.tool({
  name: "summarize-text",
  description:
    "Summarize text using the client's LLM. Requires a client with sampling support.",
  inputs: [
    {
      name: "text",
      type: "string",
      required: true,
      description: "The text to summarize",
    },
    {
      name: "maxLength",
      type: "number",
      required: false,
      description: "Maximum length of the summary in words (default: 50)",
    },
  ],
  cb: async (params, ctx?: ToolContext) => {
    if (!ctx) {
      return {
        content: [
          {
            type: "text",
            text: "Error: This tool requires a client with sampling support.",
          },
        ],
        isError: true,
      };
    }

    try {
      const maxLength = params.maxLength || 50;
      const prompt = `Summarize the following text in ${maxLength} words or less:

${params.text}`;

      // Simple call - progress is automatic
      const result = await ctx.sample({
        messages: [
          {
            role: "user",
            content: { type: "text", text: prompt },
          },
        ],
        modelPreferences: {
          intelligencePriority: 0.7,
          speedPriority: 0.6,
        },
        maxTokens: 200,
      });

      const content = Array.isArray(result.content)
        ? result.content[0]
        : result.content;

      return {
        content: [
          {
            type: "text",
            text: `Summary: ${content.text || "Unable to generate summary"}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error during sampling: ${error.message || String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
});

/**
 * Example tool using server.createMessage() directly.
 * Note: This bypasses the automatic progress handling of ctx.sample().
 * Use ctx.sample() when you need automatic progress notifications.
 */
server.tool({
  name: "translate-text",
  description:
    "Translate text to another language using the client's LLM. Requires a client with sampling support.",
  inputs: [
    {
      name: "text",
      type: "string",
      required: true,
      description: "The text to translate",
    },
    {
      name: "targetLanguage",
      type: "string",
      required: true,
      description: "The target language (e.g., 'Spanish', 'French', 'German')",
    },
  ],
  cb: async (params, ctx?: ToolContext) => {
    // Prefer ctx.sample() for automatic progress handling
    if (ctx) {
      try {
        const result = await ctx.sample({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Translate the following text to ${params.targetLanguage}:\n\n${params.text}`,
              },
            },
          ],
          systemPrompt:
            "You are a professional translator. Provide only the translation, no additional commentary.",
          modelPreferences: {
            intelligencePriority: 0.9,
            speedPriority: 0.4,
          },
          maxTokens: 500,
        });

        const content = Array.isArray(result.content)
          ? result.content[0]
          : result.content;

        return {
          content: [
            {
              type: "text",
              text: `Translation: ${content.text || "Unable to translate"}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error during translation: ${error.message || String(error)}. Make sure the client supports sampling.`,
            },
          ],
          isError: true,
        };
      }
    }

    // Fallback to server.createMessage() if no context (no progress notifications)
    try {
      const result = await server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Translate the following text to ${params.targetLanguage}:\n\n${params.text}`,
            },
          },
        ],
        systemPrompt:
          "You are a professional translator. Provide only the translation, no additional commentary.",
        modelPreferences: {
          intelligencePriority: 0.9,
          speedPriority: 0.4,
        },
        maxTokens: 500,
      });

      const content = Array.isArray(result.content)
        ? result.content[0]
        : result.content;

      return {
        content: [
          {
            type: "text",
            text: `Translation: ${content.text || "Unable to translate"}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error during translation: ${error.message || String(error)}. Make sure the client supports sampling.`,
          },
        ],
        isError: true,
      };
    }
  },
});

// Start the server
await server.listen(PORT);
console.log(`🚀 Sampling Example Server running on port ${PORT}`);
console.log(`📊 Inspector available at http://localhost:${PORT}/inspector`);
console.log(`🔧 MCP endpoint at http://localhost:${PORT}/mcp`);
console.log(`
💡 This server requires a client with sampling support to use the tools.
   See examples/client/sampling-client.ts for a client example.

📝 The ctx.sample() function automatically:
   - Sends progress notifications every 5 seconds
   - Has no timeout by default (waits indefinitely for LLM response)
   - Prevents client-side timeouts when resetTimeoutOnProgress is enabled
`);
