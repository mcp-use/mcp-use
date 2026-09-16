# Rate-limit MCP tools with Upstash

A minimal `mcp-use` server that uses [Upstash Redis](https://upstash.com/docs/redis/overall/getstarted)
and [`@upstash/ratelimit`](https://upstash.com/docs/redis/sdks/ratelimit-ts/gettingstarted)
to allow three `generate_report` calls per 30-second sliding window.
MCP middleware checks the quota before executing the tool. Redis shares the
counter across server instances and restarts.

The report is a fast local calculation so you only need an Upstash account.
Replace its callback with an expensive API call, export, or sandbox operation
to apply the same pattern to your application.

## Run

From `libraries/typescript`:

```sh
pnpm --filter mcp-use-example-upstash install
cd packages/server/examples/upstash
cp .env.example .env
```

Create an Upstash Redis database and copy its REST URL and REST token from the
[Upstash console](https://console.upstash.com/) into `.env`:

```dotenv
MCP_USE_UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
MCP_USE_UPSTASH_REDIS_REST_TOKEN=your-rest-token
```

Start the server:

```sh
pnpm dev
```

Open the Inspector URL printed by the CLI. Under **Tools**, call
`generate_report` with:

```json
{ "values": [10, 20, 30] }
```

A successful call returns:

```json
{ "count": 3, "total": 60, "average": 20, "minimum": 10, "maximum": 30 }
```

Call it four times in quick succession from an unused quota. The first three
calls produce a report; the fourth returns an MCP tool error (`isError: true`)
without executing the report callback. Wait before trying again. The error's
retry time is approximate: the sliding window accounts for calls in the
previous window, so a boundary does not necessarily restore the entire quota.
After a full minute without calls, the quota should be available again.

## Behavior

- **Shared demo quota:** all callers and server instances using the same Redis
  database and prefix share the three-call allowance. Restarting does not clear
  Redis counters. Change `prefix` to isolate independent deployments.
- **Limit tool execution:** discovery (`tools/list`) is not rate-limited, so
  Inspector can still show the tool after its quota is exhausted.
- **Missing credentials:** the server still starts; calling the tool returns
  setup instructions. No report runs without a successful quota check.
- **Provider failure:** rejected Redis requests and quota-check timeouts return
  a tool error. Upstash's default timeout behavior allows requests; this example
  explicitly rejects that result. Raw provider errors and tokens are not sent
  to MCP clients. Analytics are disabled to keep the example self-contained.
- **Customer quotas:** for an authenticated application, replace the constant
  `generate_report` key with a verified user or tenant ID plus the tool name.
  Do not trust a user ID supplied in tool arguments or an arbitrary header.
  This example has no authentication; keep it local while experimenting.

The limiter counts admitted attempts, not only successful reports; it does not
refund quota if the tool subsequently fails. This is an example-level
integration using existing middleware, with no new SDK API or cookbook page.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

Tests exercise MCP requests against the server with mocked Upstash responses:
allowed and rejected calls, timeout, provider error, missing credentials, and
unmetered discovery. They do not prove the hosted Redis algorithm. `verify`
checks configuration and types without contacting Upstash; use the Inspector
steps above for a live check with your credentials.
