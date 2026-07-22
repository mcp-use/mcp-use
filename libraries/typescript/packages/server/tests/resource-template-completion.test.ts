import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
import { listenFetch } from "./helpers/listen-fetch.js";

function completionServer(): MCPServer {
  const server = new MCPServer({
    name: "resource-template-completion",
    version: "1.0.0",
  });

  server.resourceTemplate(
    {
      name: "catalog",
      uriTemplate: "catalog://{region}/{kind}/{item}",
      complete: {
        region: ["US-East", "us-west", "eu-central"] as const,
        kind: (value) =>
          ["book", "board-game", "film"].filter((kind) =>
            kind.startsWith(value)
          ),
        item: async (value, context) => {
          await Promise.resolve();
          const prefix = `${context?.arguments?.region ?? "none"}:`;
          return [`${prefix}alpha`, `${prefix}beta`].filter((item) =>
            item.endsWith(value)
          );
        },
      },
    },
    async (uri) => ({ contents: [{ uri: uri.href, text: "catalog" }] })
  );

  server.resourceTemplate(
    {
      name: "edge-cases",
      uriTemplate: "edge://{empty}/{large}/{failure}/{plain}",
      complete: {
        empty: [],
        large: () => Array.from({ length: 125 }, (_, index) => `v${index}`),
        failure: () => {
          throw new Error("completion exploded");
        },
      },
    },
    async (uri) => ({ contents: [{ uri: uri.href, text: "edge" }] })
  );

  server.resourceTemplate(
    {
      name: "duplicate",
      uriTemplate: "duplicate://{value}",
      complete: { value: ["first"] },
    },
    async (uri) => ({ contents: [{ uri: uri.href, text: "first" }] })
  );
  server.resourceTemplate(
    {
      name: "duplicate",
      uriTemplate: "duplicate://{value}",
      complete: { value: ["second"] },
    },
    async (uri) => ({ contents: [{ uri: uri.href, text: "second" }] })
  );

  return server;
}

async function connect(url: string, modern: boolean): Promise<Client> {
  const client = new Client(
    { name: modern ? "modern-client" : "legacy-client", version: "1.0.0" },
    modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : undefined
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe("resource-template completion over HTTP", () => {
  const server = completionServer();
  let url: string;
  let modern: Client;
  let legacy: Client;

  beforeAll(async () => {
    const started = await server.listen(0);
    url = started.url;
    [modern, legacy] = await Promise.all([
      connect(url, true),
      connect(url, false),
    ]);
  });

  afterAll(async () => {
    await Promise.all([modern.close(), legacy.close()]);
    await server.close();
  });

  it("filters static readonly values by an untrimmed case-insensitive prefix", async () => {
    const matching = await modern.complete({
      ref: { type: "ref/resource", uri: "catalog://{region}/{kind}/{item}" },
      argument: { name: "region", value: "us-" },
    });
    expect(matching.completion).toEqual({
      values: ["US-East", "us-west"],
      total: 2,
      hasMore: false,
    });

    const untrimmed = await modern.complete({
      ref: { type: "ref/resource", uri: "catalog://{region}/{kind}/{item}" },
      argument: { name: "region", value: " us-" },
    });
    expect(untrimmed.completion.values).toEqual([]);
  });

  it("supports sync and async completers for different variables", async () => {
    const kind = await modern.complete({
      ref: { type: "ref/resource", uri: "catalog://{region}/{kind}/{item}" },
      argument: { name: "kind", value: "bo" },
    });
    expect(kind.completion.values).toEqual(["book", "board-game"]);

    const item = await modern.complete({
      ref: { type: "ref/resource", uri: "catalog://{region}/{kind}/{item}" },
      argument: { name: "item", value: "alpha" },
      context: { arguments: { region: "eu" } },
    });
    expect(item.completion.values).toEqual(["eu:alpha"]);
  });

  it("returns empty results for empty providers and variables without a provider", async () => {
    const empty = await modern.complete({
      ref: {
        type: "ref/resource",
        uri: "edge://{empty}/{large}/{failure}/{plain}",
      },
      argument: { name: "empty", value: "" },
    });
    expect(empty.completion.values).toEqual([]);

    const plain = await modern.complete({
      ref: {
        type: "ref/resource",
        uri: "edge://{empty}/{large}/{failure}/{plain}",
      },
      argument: { name: "plain", value: "anything" },
    });
    expect(plain.completion).toEqual({ values: [], hasMore: false });

    const inheritedName = await modern.complete({
      ref: {
        type: "ref/resource",
        uri: "edge://{empty}/{large}/{failure}/{plain}",
      },
      argument: { name: "toString", value: "anything" },
    });
    expect(inheritedName.completion).toEqual({ values: [], hasMore: false });

    const unknown = await modern.complete({
      ref: {
        type: "ref/resource",
        uri: "edge://{empty}/{large}/{failure}/{plain}",
      },
      argument: { name: "unknown", value: "anything" },
    });
    expect(unknown.completion).toEqual({ values: [], hasMore: false });
  });

  it("lets the SDK cap large results and report total and hasMore", async () => {
    const result = await modern.complete({
      ref: {
        type: "ref/resource",
        uri: "edge://{empty}/{large}/{failure}/{plain}",
      },
      argument: { name: "large", value: "" },
    });
    expect(result.completion.values).toHaveLength(100);
    expect(result.completion.total).toBe(125);
    expect(result.completion.hasMore).toBe(true);
  });

  it("surfaces unknown refs and callback errors as protocol failures", async () => {
    await expect(
      modern.complete({
        ref: { type: "ref/resource", uri: "missing://{value}" },
        argument: { name: "value", value: "" },
      })
    ).rejects.toThrow(/not found/i);

    await expect(
      modern.complete({
        ref: {
          type: "ref/resource",
          uri: "edge://{empty}/{large}/{failure}/{plain}",
        },
        argument: { name: "failure", value: "" },
      })
    ).rejects.toThrow(/completion exploded/);
  });

  it("keeps request context isolated across concurrent completions", async () => {
    const results = await Promise.all(
      ["north", "south", "west"].map((region) =>
        modern.complete({
          ref: {
            type: "ref/resource",
            uri: "catalog://{region}/{kind}/{item}",
          },
          argument: { name: "item", value: "beta" },
          context: { arguments: { region } },
        })
      )
    );
    expect(results.map((result) => result.completion.values[0])).toEqual([
      "north:beta",
      "south:beta",
      "west:beta",
    ]);
  });

  it("serves the same completion through the stateless legacy path", async () => {
    const result = await legacy.complete({
      ref: { type: "ref/resource", uri: "catalog://{region}/{kind}/{item}" },
      argument: { name: "region", value: "eu" },
    });
    expect(result.completion.values).toEqual(["eu-central"]);
  });

  it("uses the last duplicate registration and freezes after listen", async () => {
    const result = await modern.complete({
      ref: { type: "ref/resource", uri: "duplicate://{value}" },
      argument: { name: "value", value: "" },
    });
    expect(result.completion.values).toEqual(["second"]);
    expect(() =>
      server.resourceTemplate(
        {
          name: "late",
          uriTemplate: "late://{value}",
          complete: { value: ["late"] },
        },
        async (uri) => ({ contents: [{ uri: uri.href, text: "late" }] })
      )
    ).toThrow(/after the server has started/);
  });
});

describe("server.fetch resource-template completion", () => {
  it("matches listen() behavior over real HTTP", async () => {
    const mounted = completionServer();
    const listener = await listenFetch(mounted.fetch);
    const client = await connect(`${listener.url}/mcp`, true);
    try {
      const result = await client.complete({
        ref: {
          type: "ref/resource",
          uri: "catalog://{region}/{kind}/{item}",
        },
        argument: { name: "region", value: "US" },
      });
      expect(result.completion.values).toEqual(["US-East", "us-west"]);
    } finally {
      await client.close();
      await listener.close();
    }
  });
});
