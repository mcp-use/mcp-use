/**
 * Subscribe a test receiver to a server event over `server.fetch`.
 * Skeleton owned by WP-23.
 *
 * @packageDocumentation
 */

import { encodeHeaderValue } from "@mcp-use/events-core";

/** Options of {@link subscribeForTest}. */
export interface SubscribeForTestOptions {
  /** A fetch handler serving the MCP endpoint (for example `server.fetch`). */
  fetch: (request: Request) => Promise<Response>;
  /** MCP endpoint URL. */
  url: string;
  /** Event name. */
  name: string;
  /** Arguments. */
  args?: Record<string, unknown>;
  /** Callback URL. */
  callbackUrl: string;
  /** Dialect to emulate. Default `"sep-3415"`. */
  dialect?: string;
  /** Extra headers (auth). */
  headers?: Record<string, string>;
}

/** Result of {@link subscribeForTest}. */
export interface TestSubscription {
  /** Subscription id. */
  id: string;
  /** Secret generated for the subscription. */
  secret: string;
  /** Raw subscribe result. */
  result: Record<string, unknown>;
}

/**
 * Subscribe for a test.
 *
 * @param options - Target and arguments.
 */
export async function subscribeForTest(
  options: SubscribeForTestOptions
): Promise<TestSubscription> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const secret = `whsec_${btoa(String.fromCharCode(...raw))}`;
  const modern = (options.dialect ?? "sep-3415") !== "openai";
  const params: Record<string, unknown> = {
    name: options.name,
    arguments: options.args ?? {},
    delivery: { mode: "webhook", url: options.callbackUrl, secret },
  };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...options.headers,
  };
  if (modern) {
    params._meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        name: "mcp-use-test",
        version: "1",
      },
      "io.modelcontextprotocol/clientCapabilities": {
        extensions: { "io.modelcontextprotocol/events": {} },
      },
    };
    headers["mcp-protocol-version"] = "2026-07-28";
    headers["mcp-method"] = "events/subscribe";
    headers["mcp-name"] = encodeHeaderValue(options.name);
  }
  const response = await options.fetch(
    new Request(options.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "events/subscribe",
        params,
      }),
    })
  );
  const body = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
  if (body.result === undefined) {
    throw new Error(
      `subscribeForTest: events/subscribe failed (${body.error?.code}: ${body.error?.message})`
    );
  }
  return { id: String(body.result.id), secret, result: body.result };
}
