/**
 * Tests for `views.resourceUri`: a server-chosen view URI must appear on
 * `tools/list`, successful `tools/call` results, `resources/list`,
 * `resources/read`, and `contents[].uri`, while the default stays unchanged.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer, registerViews } from "../src/index.js";

type ResourceUriResolver = (viewName: string) => string;

function buildServer(resourceUri?: ResourceUriResolver): MCPServer {
  const server = new MCPServer({
    name: "view-uri-test",
    version: "1.0.0",
    ...(resourceUri !== undefined && { views: { resourceUri } }),
  });

  server[registerViews]({
    "fruit-view": {
      kind: "inline",
      js: 'console.log("fruit-view");',
      css: "",
    },
    "failure-view": {
      kind: "inline",
      js: 'console.log("failure-view");',
      css: "",
    },
  });

  server.tool(
    {
      name: "fruit",
      outputSchema: z.object({ ok: z.boolean() }),
      view: { name: "fruit-view" },
    },
    async () => ({
      structuredContent: { ok: true },
      content: [{ type: "text", text: "ok" }],
      _meta: { author: true },
    })
  );

  server.tool(
    {
      name: "fruit-failure",
      outputSchema: z.object({ ok: z.boolean() }),
      view: { name: "failure-view" },
    },
    async () => ({
      isError: true,
      content: [{ type: "text", text: "failed" }],
    })
  );

  return server;
}

async function connect(server: MCPServer): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const started = await server.listen(0);
  const client = new Client({ name: "view-uri-client", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(started.url)));
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("views.resourceUri", () => {
  it("uses the resolver on tools/list, tools/call, resources/list, and resources/read", async () => {
    const calls: string[] = [];
    const server = buildServer((viewName) => {
      calls.push(viewName);
      return `ui://views/${viewName}/build-42.html`;
    });
    const { client, close } = await connect(server);

    try {
      const expected = "ui://views/fruit-view/build-42.html";
      const { tools } = await client.listTools();
      const fruit = tools.find((tool) => tool.name === "fruit");
      expect(fruit?._meta?.["ui"]).toMatchObject({ resourceUri: expected });
      expect(fruit?._meta?.["ui/resourceUri"]).toBe(expected);

      const result = await client.callTool({ name: "fruit", arguments: {} });
      expect(result._meta?.["ui"]).toMatchObject({ resourceUri: expected });
      expect(result._meta?.["ui/resourceUri"]).toBe(expected);
      // Author metadata on the result still round-trips.
      expect(result._meta).toMatchObject({ author: true });

      const { resources } = await client.listResources();
      const view = resources.find((resource) => resource.name === "fruit-view");
      expect(view?.uri).toBe(expected);

      const read = await client.readResource({ uri: expected });
      expect(read.contents[0]?.uri).toBe(expected);
      const content = read.contents[0];
      if (content === undefined || !("text" in content)) {
        throw new Error("expected text resource contents");
      }
      expect(content.text).toContain('console.log("fruit-view");');

      // Both views resolve once, at mount; later requests reuse the cache.
      expect(calls.sort()).toEqual(["failure-view", "fruit-view"]);
      await client.listTools();
      await client.readResource({ uri: expected });
      expect(calls).toHaveLength(2);
    } finally {
      await close();
    }
  });

  it("does not stamp the resolved URI on error results", async () => {
    const server = buildServer(
      (viewName) => `ui://views/${viewName}/build-42.html`
    );
    const { client, close } = await connect(server);

    try {
      const result = await client.callTool({
        name: "fruit-failure",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.["ui/resourceUri"]).toBeUndefined();
      expect(result._meta?.["ui"]).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("keeps the stable default URIs when no resolver is configured", async () => {
    const server = buildServer();
    const { client, close } = await connect(server);

    try {
      const { tools } = await client.listTools();
      const fruit = tools.find((tool) => tool.name === "fruit");
      expect(fruit?._meta?.["ui/resourceUri"]).toBe(
        "ui://views/fruit-view.html"
      );

      const { resources } = await client.listResources();
      expect(
        resources.find((resource) => resource.name === "fruit-view")?.uri
      ).toBe("ui://views/fruit-view.html");
    } finally {
      await close();
    }
  });

  it("rejects resolver results that are not ui:// URIs", async () => {
    const server = buildServer(() => "https://example.com/view.html");
    await expect(server.listen(0)).rejects.toThrow(
      /views\.resourceUri must return a ui:\/\/ URI/
    );
  });

  it("rejects two views resolving to the same URI", async () => {
    const server = buildServer(() => "ui://views/shared.html");
    await expect(server.listen(0)).rejects.toThrow(
      /view resource URIs must be unique/
    );
  });
});
