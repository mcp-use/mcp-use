/**
 * End-to-end coverage for listener-bound resource subscriptions over the
 * modern stateless HTTP wire.
 */
import {
  Client,
  specTypeSchemas,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";

describe("resource subscriptions", () => {
  const resourceUri = "settings://app";
  const server = new MCPServer({
    name: "subscriptions-test",
    version: "1.0.0",
  });
  let client: Client;
  let revision = 0;

  server.resource({ name: "app-settings", uri: resourceUri }, async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ revision }),
      },
    ],
  }));

  server.tool(
    {
      name: "update-settings",
      inputSchema: z.object({ revision: z.number().int().nonnegative() }),
    },
    async ({ revision: nextRevision }) => {
      revision = nextRevision;
      await server.notifyResourceUpdated(resourceUri);
      return {
        content: [{ type: "text", text: `Revision ${revision}` }],
      };
    }
  );

  beforeAll(async () => {
    client = new Client(
      { name: "subscriptions-test-client", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        fetch: (input, init) => server.fetch(new Request(input, init)),
      })
    );
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("delivers an invalidation to an active listener before the client rereads", async () => {
    const acknowledged: string[] = [];
    const updated: string[] = [];
    client.setNotificationHandler(
      "notifications/subscriptions/acknowledged",
      (notification) => {
        acknowledged.push(
          ...(notification.params.notifications.resourceSubscriptions ?? [])
        );
      }
    );
    client.setNotificationHandler(
      "notifications/resources/updated",
      (notification) => {
        updated.push(notification.params.uri);
      }
    );

    const controller = new AbortController();
    let listenError: unknown;
    const listenTask = client
      .request(
        {
          method: "subscriptions/listen",
          params: {
            notifications: { resourceSubscriptions: [resourceUri] },
          },
        },
        specTypeSchemas.SubscriptionsListenResult,
        { signal: controller.signal, timeout: 30_000 }
      )
      .catch((error: unknown) => {
        listenError = error;
      });

    await vi.waitFor(() => expect(acknowledged).toContain(resourceUri));

    const before = await client.readResource({ uri: resourceUri });
    expect(before.contents[0]).toMatchObject({ text: '{"revision":0}' });

    await client.callTool({
      name: "update-settings",
      arguments: { revision: 1 },
    });
    await vi.waitFor(() => expect(updated).toContain(resourceUri));

    const after = await client.readResource({ uri: resourceUri });
    expect(after.contents[0]).toMatchObject({ text: '{"revision":1}' });
    expect(listenError).toBeUndefined();

    controller.abort();
    // The current client keeps the listen promise pending until transport
    // teardown even after its fetch is aborted. The attached catch prevents
    // an unhandled rejection; afterAll closes the transport.
    void listenTask;
  });
});
