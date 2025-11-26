/**
 * Structured Output Example - GitHub Repository Research
 *
 * This example demonstrates intelligent structured output by researching the mcp-use library.
 * The agent becomes schema-aware and will intelligently retry to gather missing
 * information until all required fields can be populated.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { config } from "dotenv";
import { z } from "zod";
import { MCPAgent, MCPClient } from "../../index.js";

// Load environment variables from .env file
config();

// Define the structured output schema using Zod
const RepoInfoSchema = z.object({
  name: z.string().describe("Name of the repository"),
  description: z.string().describe("Description of the repository"),
  stars: z.number().describe("Number of stars on GitHub"),
  contributors: z.number().describe("Number of contributors"),
  dependents: z
    .number()
    .describe("Number of dependents/packages using this library"),
  language: z.string().describe("Primary programming language"),
  license: z.string().nullable().describe("License type"),
  created_at: z.string().describe("Repository creation date"),
  last_updated: z.string().describe("Last update date"),
});

type RepoInfo = z.infer<typeof RepoInfoSchema>;

async function main() {
  const mcpConfig = {
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest"],
        env: {
          DISPLAY: ":1",
        },
      },
    },
  };

  const client = new MCPClient(mcpConfig);
  const llm = new ChatAnthropic({ model: "claude-haiku-4-5" });
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 50,
    memoryEnabled: true,
  });

  try {
    // Use structured output with intelligent retry
    // The agent will:
    // 1. Know exactly what information it needs to collect
    // 2. Attempt structured output at finish points
    // 3. Continue execution if required information is missing
    // 4. Only finish when all required fields can be populated
    const eventStream = agent.streamEvents(
      `
      Research comprehensive information about the mcp-use library on GitHub.

      Visit the GitHub repository page and gather detailed information including:
      - Number of stars
      - Number of contributors
      - Number of dependents (packages that depend on this library)
      - General repository information like description, language, license, and dates

      Use reliable sources like the GitHub repository page, npm/pypi pages, and related documentation.
      `,
      50, // maxSteps
      true, // manageConnector
      [], // externalHistory
      RepoInfoSchema // outputSchema - this enables structured output
    );

    let result: RepoInfo | null = null;

    for await (const event of eventStream) {
      // Look for structured output event
      if (event.event === "on_structured_output" && event.data?.output) {
        try {
          // Parse the structured output
          const parsed = RepoInfoSchema.parse(event.data.output);
          result = parsed;
          console.log("✅ Structured output received!");
          break;
        } catch (e) {
          console.error("❌ Failed to parse structured output:", e);
        }
      } else if (event.event === "on_structured_output_progress") {
        console.log("Processing...");
      } else if (event.event === "on_structured_output_error") {
        console.error("❌ Structured output error");
      }
    }
    if (!result) {
      throw new Error("Failed to obtain structured output");
    }

    // Now you have strongly-typed, validated data!
    console.log(`Name: ${result.name}`);
    console.log(`Description: ${result.description}`);
    console.log(`Stars: ${result.stars.toLocaleString()}`);
    console.log(`Contributors: ${result.contributors}`);
    console.log(`Dependents: ${result.dependents}`);
    console.log(`Language: ${result.language}`);
    console.log(`License: ${result.license || "Not specified"}`);
    console.log(`Created: ${result.created_at}`);
    console.log(`Last Updated: ${result.last_updated}`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await agent.close();
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

main().catch(console.error);
