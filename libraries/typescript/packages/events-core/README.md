# @mcp-use/events-core

The MCP Events wire contract shared by the mcp-use server (`mcp-use`), client (`@mcp-use/client`), Inspector and CLI. It covers both dialects mcp-use serves: SEP-3415 (`io.modelcontextprotocol/events`) and the ChatGPT dialect.

It has no dependencies and uses WebCrypto only, so it runs on Node, Bun, Deno, Cloudflare Workers and in browsers. It imports nothing from `@modelcontextprotocol/*`.

Use it directly when you write your own webhook receiver, client or tooling for MCP Events.

## What it contains

- **Wire types and constants** for `events/list`, `events/subscribe`, `events/unsubscribe`, `events/poll`, `events/stream`, the `notifications/events/*` frames and the webhook control envelopes.
- **Delivery profiles**: the axes and the `openai@1` and `sep-3415@1` presets, `resolveProfile`, and the rules for profiles stored by other builds.
- **`KNOWN_CLIENTS`**: the known-client table (ChatGPT, TanStack AI, the AI SDK) with the evidence for each row.
- **Errors**: `EventsError`, the codes of the three numberings (`sketch`, `sep`, `documented`) and `decodeEventsError`.
- **Ids**: `canonicalJson`, `deriveSubscriptionId` and `deriveDirectId`, which equal the official TypeScript SDK's Events ids, and `normalizeEventIdHeaderSafe`.
- **Standard Webhooks**: `signWebhook`, `verifyWebhook`, `generateWebhookSecret`, `validateWebhookSecret`, `parseWebhookSecret` and `generateWebhookId`.
- **Routing headers**: `Mcp-Name` and `Mcp-Param-*` encoding, decoding and checks, and `x-mcp-header` validation.
- **`createEventsNotificationDispatcher`**: one router for push frames on a client connection.

## Verifying a webhook delivery

```ts
import { verifyWebhook } from "@mcp-use/events-core";

export async function handle(request: Request): Promise<Response> {
  const body = new Uint8Array(await request.arrayBuffer());
  try {
    const { webhookId, subscriptionId } = await verifyWebhook({
      secrets: [process.env.EVENTS_WEBHOOK_SECRET!],
      headers: request.headers,
      body,
    });
    // Deduplicate on webhookId, then handle JSON.parse(new TextDecoder().decode(body)).
    return new Response(null, { status: 204 });
  } catch {
    return new Response("invalid signature", { status: 401 });
  }
}
```

## Vectors

`vectors/*.json` hold the contract as data: subscription ids (twelve shared with the SDK's Events extension), canonical JSON, webhook signatures (including the published Standard Webhooks vector), secrets, `eventId` normalization, header values, error codes and presets. They are published with the package (`@mcp-use/events-core/vectors/<file>.json`) so other implementations can test against them.

## Conformance

`@mcp-use/events-core/conformance` exports the conformance catalog and runner API (`runConformance`, `toJUnit`).
