import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { FIXTURE, slowTool } from "./scenarios.js";

/** The part of the v2 `McpServer` registration API the fixture uses (Skybridge and mcp-handler share it). */
type V2Registrar = Pick<McpServer, "registerResource" | "registerPrompt"> & {
  registerTool: McpServer["registerTool"];
};

/** Register the shared fixture surface on an SDK v2 `McpServer`. */
export function registerV2Fixture<T extends V2Registrar>(
  server: T,
  tools = true
): T {
  if (tools) {
    server.registerTool(
      FIXTURE.tools.echo,
      { inputSchema: z.object({ text: z.string() }) },
      async ({ text }) => ({
        content: [{ type: "text", text: `echo: ${text}` }],
      })
    );
    server.registerTool(FIXTURE.tools.fail, {}, async () => ({
      isError: true,
      content: [{ type: "text", text: "bad input" }],
    }));
    server.registerTool(FIXTURE.tools.explode, {}, async () => {
      throw new Error("kaput");
    });
    server.registerTool(FIXTURE.tools.slow, {}, async () => ({
      content: [{ type: "text", text: await slowTool() }],
    }));
  }
  server.registerResource(
    "note",
    FIXTURE.resourceUri,
    { mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, text: "hello" }] })
  );
  server.registerPrompt(
    FIXTURE.prompt,
    { argsSchema: z.object({ name: z.string() }) },
    ({ name }) => ({
      messages: [
        { role: "user", content: { type: "text", text: `Hello ${name}` } },
      ],
    })
  );
  return server;
}
