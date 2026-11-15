# mcp-use-analytics

Manufact analytics for Python MCP servers that you host yourself. One call sends one
event per JSON-RPC request your server handles (tool calls, resource reads, prompts,
list methods, `initialize`) to Manufact, where they show up in Analytics, Sessions,
Observability and issues next to traffic that goes through the Manufact gateway.

- No runtime dependencies (standard library only), Python 3.10+.
- Works with community `fastmcp` 2.x, 3.x and 4.x, the official `mcp` SDK 1.x
  (`FastMCP` and the low-level `Server`) and 2.x (`MCPServer` and the low-level `Server`),
  and mcp-use's `MCPServer`. Tested with `mcp` 1.9.4, 1.10.1, 1.30.0 and 2.3.0, `fastmcp`
  2.9.2, 2.14.7, 3.4.9 and 4.1.1, and `mcp-use` 1.7.1.
- Never raises into a request and never waits on the network: events go to a bounded
  in-memory queue that a background thread sends in batches.

## Install

```bash
pip install mcp-use-analytics
# or
uv add mcp-use-analytics
```

Create an analytics key for your server in the Manufact dashboard (server settings,
"Analytics SDK") and expose it to the server process:

```bash
export MANUFACT_ANALYTICS_KEY=mfi_...
```

## Usage

Call `instrument()` once, after creating the server and before serving it. Tools,
resources and prompts registered later are covered too.

```python
from mcp_use_analytics import instrument
```

| Framework | One line |
| --- | --- |
| `fastmcp` 2.x / 3.x / 4.x | `mcp = FastMCP("demo"); instrument(mcp)` |
| official `mcp` 1.x `FastMCP` | `mcp = FastMCP("demo"); instrument(mcp)` (from `mcp.server.fastmcp`) |
| official `mcp` 1.x low-level | `server = Server("demo"); instrument(server)` (from `mcp.server.lowlevel`) |
| official `mcp` 2.x `MCPServer` | `mcp = MCPServer("demo"); instrument(mcp)` (from `mcp.server.mcpserver`) |
| official `mcp` 2.x low-level | `server = Server("demo", on_call_tool=...); instrument(server)` |
| mcp-use `MCPServer` | `server = MCPServer(name="demo"); instrument(server)` (from `mcp_use.server`) |

`instrument()` returns the server, so `mcp = instrument(FastMCP("demo"))` works. Calling
it again on the same server does nothing.

Every transport is covered: streamable HTTP (stateful and stateless), SSE, stdio and
in-process clients. The server keeps running exactly as before when the key is missing
(one warning is logged), when analytics is disabled, or when anything inside the package
fails.

## Options

```python
instrument(
    server,
    api_key=None,            # default: $MANUFACT_ANALYTICS_KEY
    endpoint=None,           # default: $MANUFACT_ANALYTICS_URL, else https://ingest.run.mcp-use.com
    enabled=None,            # False: off. True: on even if $MANUFACT_ANALYTICS_DISABLED is set
    capture_payloads=None,   # False: never send payloads. None/True: follow the dashboard setting
    redact=None,             # redact(payload, context) -> payload | None
    identify=None,           # identify(request) -> {"id"?, "name"?, "email"?} | None
    conversation_id=None,    # "id" or conversation_id(request) -> str | None
    debug=False,             # log every event and delivery to the "mcp_use_analytics" logger
)
```

| Environment variable | Meaning |
| --- | --- |
| `MANUFACT_ANALYTICS_KEY` | The server's analytics key (`mfi_...`). |
| `MANUFACT_ANALYTICS_URL` | Ingest origin (for example a dev or devspace ingest host). |
| `MANUFACT_ANALYTICS_DISABLED` | `1`/`true`/`yes`/`on` turns analytics off. |

`identify` and `conversation_id` receive a `RequestInfo` (method, target, raw params,
lowercased headers, session id, client name/version, raw bearer token). They run on the
request path, so keep them fast; exceptions in them are ignored.

```python
from mcp_use_analytics import RequestInfo, instrument

def identify(request: RequestInfo):
    user = my_auth.user_for(request.access_token)  # your own lookup, no network calls
    return {"id": user.id, "name": user.name, "email": user.email} if user else None

instrument(mcp, identify=identify, conversation_id=lambda r: r.headers.get("x-conversation-id"))
```

Without `identify`, the end user is derived from the `Authorization: Bearer` token exactly
like the Manufact gateway does it (SHA-256 of the JWT's `iss` + NUL + `sub`, else of the
token), so the same user links across gateway and SDK traffic.

Every key `identify` returns is optional and replaces only its own default, the same as in
`@mcp-use/analytics`:

| Key | Sent as | Default when left out |
| --- | --- | --- |
| `id` (string or number) | `sha256(id)`, the actor's `token_hash` | the Bearer token's hash |
| `name` | the actor's name | the token's `name` claim |
| `email` | the actor's email | the token's `email` claim |

So `{"name": user.name, "email": user.email}` keeps the token hash (and the link to the
user's gateway traffic) and labels the actor. Returning `None` keeps every default (in
TypeScript that is `undefined`; a TypeScript hook can also return `null` for "no actor",
which has no Python equivalent). Names and emails are sent only with an actor (an `id` or
a Bearer token) and only while "identify actors" is on in the dashboard; names over 256
and emails over 320 characters are dropped. The ingest edge keeps a name or email only next
to a `token_hash`, so when `identify` returns a `name` or `email` without an `id` and the
request has no Bearer token, no actor is sent at all (the same in `@mcp-use/analytics`).

## Serverless

Events are sent from a daemon thread, at most about a second after they are recorded.
Serverless runtimes freeze or end the process between invocations, and this package has
no `waitUntil` hook (unlike `@mcp-use/analytics` on Vercel), so call `flush()` before
every invocation returns, on Vercel too. It sends and waits for the events recorded
before the call only, so on runtimes that run several invocations in one instance (Cloud
Run, Vercel Fluid) the others keep recording without holding it up:

```python
from mcp_use_analytics import flush

def handler(event, context):
    try:
        return app(event, context)
    finally:
        flush(timeout=2.0)
```

`flush(timeout=5.0)` and `shutdown(timeout=5.0)` are synchronous and return `True` when
every event recorded before the call was delivered (or dropped as undeliverable) within
`timeout`; do not `await` them. In async code, run the flush off the event loop with
`await asyncio.to_thread(flush, 2.0)`.

On Vercel, AWS Lambda, Azure Functions and Cloud Run (detected through their environment
variables) events are sent right away instead of waiting for a batch; the `flush()` above
is still needed. `shutdown()` flushes and stops delivery for good. At interpreter exit a
flush with a 2-second timeout runs automatically; forked workers (gunicorn, uvicorn
`--workers`) start with an empty queue and their own delivery thread.

stdio servers send each event right away. A client that kills the server process
without closing its stdin first (the MCP spec asks clients to close stdin and wait) can
still cut off the last events; flush from your own `SIGTERM` handler if that matters.

## Privacy

- Request and response payloads are sent only when payload capture is on for the server
  in the dashboard **and** `capture_payloads` is not `False`. The ingest edge drops them
  again when the dashboard setting is off.
- Before a payload leaves the process, a default redactor replaces values under
  sensitive keys (passwords, secrets, tokens, API keys, cookies, authorization, private
  keys, ...), credential-looking strings (Bearer tokens, JWTs), binary data and base64
  image/audio/blob contents, truncates long strings and cycles, and caps the payload at
  100,000 characters. `redact_payload()` is exported if you want to reuse it.
- Your `redact(payload, context)` hook runs after the default redactor, on the delivery
  thread, only while payloads are captured: once for the request and once for the
  response, with a `PayloadContext` (`kind` is `"request"` or `"response"`, plus `method`
  and `target`). Return the payload to send; returning `None` or raising drops only that
  payload, and the event is still sent. This differs from `@mcp-use/analytics`, whose
  `redact(event)` sees the whole event, on every event, and drops it on `null`.
- Raw tokens are never sent, only their hashes. Names and emails (from `identify` or the
  JWT's `name`/`email` claims) are sent only when "identify actors" is on in the dashboard.
- End-user IP addresses are never sent. Country comes only from your CDN's headers
  (`CF-IPCountry`, `X-Vercel-IP-Country`, `CloudFront-Viewer-Country`) or ChatGPT's
  `_meta["openai/userLocation"]`.
- Requests that came through the Manufact gateway (header `X-Gateway-Request-Id`) are
  skipped, because the gateway already recorded them.
- This package is separate from mcp-use's anonymous product telemetry and its
  `MCP_USE_ANONYMIZED_TELEMETRY` opt-out.

## Wire format

`POST {endpoint}/v1/events` with `Authorization: Bearer mfi_...` and a JSON body in the
public `manufact.sdk.v1` format (additive changes only):

```jsonc
{
  "schema": "manufact.sdk.v1",
  "sdk": { "name": "mcp-use-analytics", "version": "0.1.0", "language": "python",
           "framework": "fastmcp", "framework_version": "3.4.9", "runtime": "python/3.12.13" },
  "server": { "name": "demo", "version": "1.0.0" },      // initialize result serverInfo
  "events": [{
    "id": "0199f0c2-…",            // UUIDv7, reused on retries
    "time": "2026-10-19T08:00:00.000Z", "duration_ms": 12.5,
    "method": "tools/call", "request_id": 7, "target": "get_balance",
    "outcome": "tool_error",        // success | tool_error (result.isError) | error (JSON-RPC error)
    "error": { "message": "Account not found" },
    "session_id": "…", "client": { "name": "claude-ai", "version": "0.1.0" },
    "protocol_version": "2025-06-18", "transport": "streamable-http", "stateless": false,
    "http": { "method": "POST", "path": "/mcp", "host": "app.example.com", "user_agent": "…" },
    "actor": { "token_hash": "<sha256 hex>" },
    "request_size": 312, "response_size": 2048
    // plus client_info (initialize only), conversation_id, openai, trace_id,
    // request_payload / response_payload (full JSON-RPC messages) when capture is on
  }]
}
```

The endpoint answers `202 {accepted, rejected, config}`; `config.capture_payloads` and
`config.identify_actors` (also served by `GET /v1/config`) decide what is sent. The package
reads `GET /v1/config` before its first batch, and again before encoding events whenever the
settings in hand are more than a minute old (no `202` in that time), so a dashboard change
applies to the first batch recorded a minute later. Payloads and the token's name and email
are kept in memory until the event is encoded, so they follow the setting at that moment. A
failed refresh keeps the last settings, delays nothing beyond its 2-second timeout and is
retried a minute later; none is made while a `429` holds sends back. Events listed in `rejected` with `"retryable": true` (`queue_unavailable`: the edge
could not enqueue them) are sent again with backoff, alone; the rest of the batch was
accepted (or rejected for good) and is never sent twice. `401` (invalid or revoked key) stops
delivery, `402` (credits exhausted) drops events for five minutes, `400`/`4xx` drop the batch
(`413` splits it first), and `408`/`5xx`/network errors (nothing was enqueued) retry the whole
batch with exponential backoff (0.5 s doubling, each wait jittered to 50-100 %, at most 60 s),
or after the response's `Retry-After` (at most ten minutes). Each of those, and each
`retryable` rejection, is a failed attempt: a batch is dropped after 8 of them, about 30 to 60
seconds of backoff, so a longer outage loses the events recorded during it.

A `429` (the key's or the organization's event budget is spent) holds back every send for the
key until its `Retry-After` has passed (at least one second, at most ten minutes), `flush()`
included (it returns `False` if its timeout ends first), while events keep queuing. Being rate limited is not a failed attempt, so a batch
survives any number of `429`s; a `429` without `Retry-After` counts as one. `@mcp-use/analytics`
uses the same retry budget, backoff schedule and `429` rule.

`http` carries no `status`: the package records requests at the MCP layer, not from the HTTP
response, and the ingest edge records `200` (`202` for a notification) for these events, as
for stdio.

The `outcome` of an event is what the client received: a tool exception that the
framework turns into an `isError` result is a `tool_error` with the result's text, while
`McpError`/`MCPError`, unknown methods and invalid params are `error` with the JSON-RPC code.
A request the client gave up on before any response (a stateless HTTP client that timed out
or disconnected, a session deleted mid-request, a stdio client that closed stdin, a cancelled
request) is still recorded once, without `outcome`, `error` or `response_size`; the ingest
edge counts it like the gateway's requests whose stream closed before the response. If the
server answers it anyway while the connection is still open, the event has that answer's
outcome instead.

Numbers that JSON cannot hold (`NaN`, `Infinity`, a client's `1e400`) are sent as `null`, so
one odd value never invalidates a batch. `request_size` and `response_size` are measured
without encoding the messages again (exact for ordinary messages, sampled for very large
strings and lists), so large results never stall the server while events are prepared.

## How it hooks in

- `mcp` 1.x (low-level `Server`, official `FastMCP`, mcp-use, `fastmcp` 2.x/3.x): the
  instance's `run()` is wrapped to observe that connection's message streams. One request
  in and its response out make one event, so `initialize` (answered inside the SDK's
  `ServerSession`), unknown methods and errors are recorded exactly as sent, however and
  whenever handlers are registered. Nothing global is patched.
- `mcp` 2.x (low-level `Server`, `MCPServer`, `fastmcp` 4.x): a middleware is inserted first
  in `Server.middleware`, the SDK's seam that wraps every inbound request.
- A per-request context guard makes nested or duplicated instrumentation (an in-process
  proxied or mounted server, `instrument()` on both a server and its low-level server)
  record each request once.

## Development

```bash
cd libraries/python-analytics
uv sync                                   # dev tools (ruff, ty)
uv run ruff check . && uv run ruff format --check . && uv run ty check
```

Releases publish to PyPI through trusted publishing when `version` in `pyproject.toml`
changes on `main`.
