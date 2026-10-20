# `@mcp-use/analytics`

Manufact analytics for MCP servers you host yourself. One `instrument()` call
records an event for every JSON-RPC request your server handles and sends it
to Manufact in the background, where it powers the same Analytics, Sessions
and Gateway Requests views as traffic through the Manufact gateway. Clients
keep connecting to your URL; nothing sits between them and your server.

No runtime dependencies. Works on Node.js 18+, Bun, Deno, Cloudflare Workers
and Vercel (Node and Edge), as ESM or CommonJS.

## Install

```bash
npm install @mcp-use/analytics
```

Create a key on the server's **Analytics SDK** card in the Manufact dashboard
and set it in your server's environment:

```bash
MANUFACT_ANALYTICS_KEY=mfi_...
```

## Usage

```ts
import { instrument } from "@mcp-use/analytics";
```

| Framework | Call |
| --- | --- |
| Official SDK v1 (`@modelcontextprotocol/sdk`) | `instrument(new McpServer({ name, version }))`, or `instrument(server)` on a low-level `Server` |
| Official SDK v2 (`@modelcontextprotocol/server`) | `createMcpHandler(() => instrument(new McpServer({ name, version })))` |
| Skybridge | `new Skybridge({ name, version, handler: (server) => instrument(server).registerTool(…) })`, or `instrument(app)` once |
| Vercel `mcp-handler` | `createMcpHandler((server) => { instrument(server); server.registerTool(…); })` |
| mcp-use (`MCPServer`) | `instrument(server)` before `server.listen()` or the first request |

- Call it before or after registering tools: handlers registered later are
  recorded too.
- Servers built per request (stateless HTTP, `createMcpHandler`, Skybridge)
  are instrumented per request; it is cheap, and every instance shares one
  queue.
- Calling it twice on the same server records each request once.
- mcp-use 1.x `MCPServer` is supported through its per-session
  `getServerForSession()`.
- Batches are labeled with the detected framework (`sdk.framework`).
  `mcp-handler` leaves no trace on the server except its default
  `serverInfo.name`, so a handler that sets its own `serverInfo` is labeled
  with the SDK underneath (`mcp-sdk-v2`, or `mcp-sdk-v1` on mcp-handler 1.x);
  pass `framework: "mcp-handler"` to label it.
- Without a key it logs one warning and leaves the server untouched. It never
  throws into your handlers and never changes what they return.

## Options

Every option is optional; `instrument(server, options)`.

| Option | Default | Purpose |
| --- | --- | --- |
| `apiKey` | `MANUFACT_ANALYTICS_KEY` | The server's analytics key (`mfi_…`). |
| `endpoint` | `MANUFACT_ANALYTICS_URL`, else `https://ingest.run.mcp-use.com` | Ingest origin. |
| `enabled` | off when `MANUFACT_ANALYTICS_DISABLED` is `1`/`true` | Turn recording on or off. |
| `capturePayloads` | follow the dashboard | `false` never sends payloads; `true` cannot override the dashboard. |
| `redact(event)` | none | Edit an event, or return `null` to drop it, before it leaves the process (see Privacy). May be async; a throw, or a promise not settled within 2 s, drops the event. |
| `identify(ctx)` | Bearer token hash + JWT `name`/`email` | Return `{ id?, name?, email? }`: each key replaces only its own default (`id` is sent as `sha256(id)` in place of the token hash). `undefined` keeps every default, `null` sends no actor. A `name` or `email` without an `id` and without a Bearer token sends no actor (see Privacy). A throw, or a promise not settled within 2 s, keeps the defaults. |
| `conversationId(ctx)` | none | Your own conversation id for the request. A promise not settled within 2 s sends none. |
| `waitUntil(promise)` | Vercel's request context | Keep a serverless invocation alive until events are sent. |
| `framework` | detected | Label sent as `sdk.framework`, for servers detection cannot tell (`"mcp-handler"` with a custom `serverInfo`). |
| `debug` | `false` | Log delivery decisions to the console. |
| `flushIntervalMs` | `1000` | Longest time an event waits before a flush. |
| `maxBatchSize` | `100` (max 500) | Events per request to the ingest endpoint. |
| `maxQueueSize` | `1000` | Events kept in memory waiting to be sent or retried; the oldest are dropped beyond it. It bounds memory; it does not extend retries (see Delivery). |

`flush()` sends queued events now and resolves once every event queued before
the call was attempted, even while new traffic keeps arriving; `shutdown()`
flushes and stops recording. A slow hook never holds a flush: hooks get 2
seconds.

Servers that share a key share one queue: the delivery settings (`debug`,
`flushIntervalMs`, `maxBatchSize`, `maxQueueSize`) come from the first
`instrument()` call for that key, while the hooks and `capturePayloads` apply
to the server they were passed with.

## Shutdown

Events are batched (up to `maxBatchSize`, or about a second) and sent off the
request path. Long-running servers need nothing extra:

- The flush timer never keeps the process alive. When the event loop empties
  (a CLI, a test run, a stdio server whose client quit), queued events get
  one more attempt, bounded to about 2 seconds in total and never retried, so
  an unreachable endpoint cannot keep a finished process alive.
- On `SIGINT` (Ctrl+C) and `SIGTERM` (a deploy or restart) under Node.js and
  Bun, queued events are sent at once, without waiting for the dashboard's
  capture settings (while they are unknown, events go without payloads or
  names). What the signal does is unchanged:
  - When nothing else handles the signal, the process still dies by it once
    the events are sent, at most about 2 seconds later, with the same exit
    status as without the SDK (130 or 143). A second Ctrl+C exits at once.
  - When your code or your framework handles the signal, it keeps control of
    shutdown: the SDK only sends, and never exits or keeps the process
    running. A `process.exit()` called while the events are being sent (for
    example Skybridge's, as soon as its HTTP server closed) waits until they
    are, at most about 2 seconds, then exits with the same code.
  - Nothing is installed on Deno, Cloudflare Workers or edge runtimes, or
    when recording is off (`MANUFACT_ANALYTICS_DISABLED`, `enabled: false`,
    no key).
- In your own shutdown code, `await shutdown()` sends what is queued and
  stops recording. Events still queued when the process is killed outright
  (`SIGKILL`, for example after a platform's grace period) are lost.

## Serverless

- **Vercel**: handled automatically through the request context's `waitUntil`.
- **Cloudflare Workers**: `ctx.waitUntil(flush())` after handling the request,
  or pass `waitUntil: (p) => ctx.waitUntil(p)`.
- **Elsewhere**: pass your platform's `waitUntil`, or `await flush()` before
  the invocation ends.

## Privacy

- Raw tokens never leave the process. The caller's Bearer token is sent as
  `actor.token_hash`, computed exactly like the gateway (`sha256(iss \0 sub)`
  for a JWT, else `sha256(token)`; `mcp_` API keys are skipped), so actors
  match across gateway and SDK traffic.
- Names and emails are sent only with an actor, that is with a
  `token_hash` (an `id` from `identify`, or the request's Bearer token), and
  only while **Identify actors** is on in the dashboard. The edge keeps a
  name or email only next to a `token_hash`, so when `identify` returns a
  `name` or `email` without an `id` and the request has no Bearer token, no
  actor is sent, as in the Python SDK.
- Payloads are sent only while **Capture payloads** is on in the dashboard and
  `capturePayloads` is not `false`. They first go through a default redactor,
  the same rules as the Python SDK's: values under keys such as
  `authorization`, `password`, `token`, `secret`, `api_key`, `access_key`,
  `cookie` and `private_key` (and the exact keys `auth`, `pwd`, `pin`, `otp`,
  `ssn`, `cvv`, `cvc`, `card_number`, `credit_card`) become `[REDACTED]`, as do
  strings that look like credentials under any key (`Bearer …` values, JWTs,
  `mfi_` keys); binary data and base64 media are replaced by a size; strings
  are cut at 10,000 characters; cycles are removed; anything over 100,000
  characters is replaced by a marker. Until the endpoint has reported the
  dashboard settings, nothing optional is sent.
- Your `redact(event)` hook runs after the default redactor, at flush time, on
  every event, including when payloads are not captured (the event then has
  no `request_payload` or `response_payload`). Return the event, edited or not
  (`undefined` keeps it unchanged); `null` drops the whole event. This differs
  from the Python SDK, whose `redact(payload, context)` sees one captured
  payload at a time and drops only that payload.
- End-user IP addresses are never sent.
- Requests that carry `X-Gateway-Request-Id` came through the Manufact gateway,
  which already records them, and are skipped.

This is separate from mcp-use's anonymous product telemetry and its opt-out.

## Delivery

`POST {endpoint}/v1/events` with `Authorization: Bearer <key>`. The
dashboard's capture settings (**Capture payloads**, **Identify actors**) come
from `GET {endpoint}/v1/config`, read before the first batch (waiting at most
3 seconds), and from every `202`. Before serializing a batch, the SDK reads
`GET /v1/config` again when the settings in hand are more than a minute old
(no `202` in that time), so a dashboard change applies to the first batch
recorded a minute after it. Payloads and the token's name and email are kept
in memory until the event is serialized, so they follow the setting at that
moment. A failed refresh keeps the last settings, delays the batch by at most
its 2-second timeout and is retried a minute later; none is made while a `429`
pauses sending, nor by the exit and signal flushes. The Python SDK
(`mcp-use-analytics`) reads the settings the same way.

Network errors, `408` and `5xx` are retried with exponential backoff (0.5 s
doubling, each wait jittered to 50-100 %, at most 60 s), reusing event ids; a
`503` means nothing of the batch was accepted, so all of it is resent, after
its `Retry-After` (at most ten minutes) when it has one. A `202` lists the
events it did not take in `rejected`: an entry with `retryable: true` (the
edge could not enqueue it) is retried the same way, any other entry is
dropped, and accepted events are never sent again. Each of these is a failed attempt, and a batch is dropped
after 8 of them, which is about 30 to 60 seconds of backoff: an outage longer
than that loses the events recorded during it, whatever `maxQueueSize` is.

A `429` (the key's or the organization's event budget is spent) pauses every
send for its `Retry-After` (at least one second, at most ten minutes),
`flush()` included, while events keep queuing up to `maxQueueSize`; they go
out in full batches when it ends. The pause is not a failed attempt, so a
batch survives any number of them; a `429` without `Retry-After` counts as one.
A `401` stops recording until the process restarts, a `402` (credits
exhausted) drops events and pauses for ten minutes, and other `4xx` responses
drop the batch. The Python SDK (`mcp-use-analytics`) follows the same retry
policy.

## Wire format

Batches use the `manufact.sdk.v1` schema (additive changes only):

```jsonc
{
  "schema": "manufact.sdk.v1",
  "sdk": { "name": "@mcp-use/analytics", "version": "0.1.0", "language": "typescript",
           "framework": "mcp-sdk-v1", "runtime": "node/22.11.0" },
  "server": { "name": "weather", "version": "1.0.0" },
  "events": [{
    "id": "0199f…",                       // UUIDv7, reused on retry
    "time": "2026-10-19T08:00:00.000Z",   // request start
    "duration_ms": 12.5,                  // handler latency
    "method": "tools/call",
    "request_id": 7,
    "target": "get_weather",              // tool name, resource URI or prompt name
    "outcome": "success",                 // success | tool_error | error
    "error": { "code": -32602, "message": "…" },
    "session_id": "…", "conversation_id": "…",
    "client": { "name": "claude-ai", "version": "0.1.0" },
    "client_info": { … },                 // initialize only
    "protocol_version": "2025-06-18", "transport": "streamable-http", "stateless": false,
    "http": { "status": 200, "method": "POST", "path": "/mcp", "host": "…", "user_agent": "…",
              "origin": "…", "referer": "…", "country": "BR" },
    "actor": { "token_hash": "…", "name": "…", "email": "…" },
    "openai": { "session": "…", "subject": "…", "organization": "…", "country": "US" },
    "trace_id": "…",
    "request_size": 312, "response_size": 2048,
    "request_payload": { … }, "response_payload": { … }
  }]
}
```

`outcome` is `tool_error` for a `tools/call` result with `isError: true` (its
text content is the message) and `error` for a JSON-RPC error or a thrown
handler, with the JSON-RPC code. An HTTP error with no JSON-RPC reply (an error
page, a middleware's `5xx`) is an `error` with the message `HTTP <status>` and
no code. On mcp-use the outcome is the reply the client received, so a result
that fails the tool's `outputSchema` after the handler returned is a
`tool_error`. Latency is measured inside your server, so it excludes the
network between the client and your server.

`http.status` is sent only by the mcp-use adapter, which sees the HTTP
response; the other adapters leave it out, and the ingest edge records `200`
(`202` for a notification) for them, as it does for stdio.

A request the client cancelled, or whose response it never received, is sent
once without `outcome`, `error` or response, timed until the cancellation,
and the edge counts it like a gateway request whose stream closed before the
response. That covers `notifications/cancelled`, a 2026-07-28 client
aborting its HTTP request (mcp-use answers that with `499`, which is not
sent as the status), and a client gone mid-stream; what the handler returns
afterwards is ignored, as the SDKs do not send it. On a stateless server the
notification arrives in an HTTP request of its own, so it is matched to the
in-flight request with the same JSON-RPC id from the same requester (same
`Authorization`, `User-Agent` and forwarding headers); when two such
requests cannot be told apart, neither is cancelled.

Every field is clipped to the ingest endpoint's limits (for example `target`
4096 characters, `client.name` 256, `http.host` 260, `http.referer` 4096) so
an oversized value never gets an event rejected; a trace id longer than 64
hex characters and an error code outside int32 are left out.
