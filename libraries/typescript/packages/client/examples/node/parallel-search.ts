/**
 * Search the web with the hosted Parallel Search MCP server.
 *
 * This example calls the server directly, so it does not require an LLM, a
 * Parallel account, or an API key. Search results are printed as returned by
 * the server so their citations and source URLs remain available.
 *
 * Run from packages/client:
 *   node examples/node/parallel-search.ts "latest Model Context Protocol news"
 */

import { MCPClient } from "@mcp-use/client";

const SERVER_NAME = "parallel-search";
const DEFAULT_QUERY = "latest Model Context Protocol news";
const query = process.argv.slice(2).join(" ").trim() || DEFAULT_QUERY;

async function main(): Promise<void> {
  const client = new MCPClient({
    mcpServers: {
      [SERVER_NAME]: {
        url: "https://search.parallel.ai/mcp",
      },
    },
  });

  try {
    const connection = await client.connect(SERVER_NAME);
    const result = await connection.callTool("web_search", {
      objective: `Find current, relevant web sources for: ${query}`,
      search_queries: [query],
    });

    if (result.isError) {
      throw new Error(`Search failed: ${JSON.stringify(result.content)}`);
    }

    let printedResult = false;
    for (const block of result.content) {
      if (block.type === "text") {
        console.log(block.text);
        printedResult = true;
      }
    }

    if (!printedResult) {
      throw new Error("Search returned no text content");
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
