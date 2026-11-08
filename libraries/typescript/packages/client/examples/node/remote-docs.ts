/**
 * Read-only remote docs example for @mcp-use/client.
 *
 * Connects to the public BlockVectra docs MCP endpoint, searches for a page,
 * then reads the page that the search returned. No local server, model, API
 * key, or account is needed, but the remote endpoint requires network access.
 *
 * Run from an installed checkout of this repo, inside packages/client:
 *   pnpm exec tsx examples/node/remote-docs.ts
 */

import { MCPClient } from "@mcp-use/client";

const TIMEOUT = 15000;
const LANG = "en";

function textOf(
  result: { isError?: boolean; content: unknown[] },
  label: string
): string {
  if (result.isError) throw new Error(`${label} returned an error result`);
  for (const block of result.content) {
    if (typeof block !== "object" || block === null) continue;
    if ("type" in block && block.type === "text" && "text" in block) {
      if (typeof block.text === "string" && block.text.trim()) {
        return block.text;
      }
    }
  }
  throw new Error(`${label} returned no text content`);
}

function firstResultPath(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "results" in payload) {
    const { results } = payload;
    if (Array.isArray(results) && results.length > 0) {
      const first: unknown = results[0];
      if (typeof first === "object" && first !== null && "path" in first) {
        if (typeof first.path === "string" && first.path !== "") {
          return first.path;
        }
      }
    }
  }
  throw new Error("search_docs returned no usable results; stopping");
}

async function main(): Promise<void> {
  const client = new MCPClient({
    mcpServers: {
      docs: {
        url: "https://docs.blockvectra.com/mcp/docs",
        oauth: false,
        detectMixedAuth: false,
        timeout: TIMEOUT,
        headers: {
          "User-Agent": "mcp-use-remote-docs-example/1 BlockVectraQA/1",
        },
      },
    },
  });

  try {
    const connection = await client.connect("docs");

    const tools = await connection.listTools({ timeout: TIMEOUT });
    console.log("tools:", tools.map((t) => t.name).join(", "));

    const search = await connection.callTool(
      "search_docs",
      { query: "quickstart", lang: LANG, limit: 1 },
      { timeout: TIMEOUT }
    );
    const payload: unknown = JSON.parse(textOf(search, "search_docs"));
    const path = firstResultPath(payload);
    console.log("first result:", path);

    const doc = await connection.callTool(
      "read_doc",
      { path, lang: LANG },
      { timeout: TIMEOUT }
    );
    console.log(textOf(doc, "read_doc"));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
