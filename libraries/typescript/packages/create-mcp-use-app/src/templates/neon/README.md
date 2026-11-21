# Getting started with Neon and mcp-use

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI agent CRUD access to an event database. Built with [mcp-use](https://github.com/mcp-use/mcp-use), [Neon](https://neon.com) Postgres, and [Drizzle ORM](https://orm.drizzle.team) — deployed as a Neon Function.

The server exposes four tools over the streamable HTTP transport:

| Tool            | Description                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `create_event`  | Create an event with a required title and start time; location, description, and URL are optional.          |
| `update_event`  | Update an event by ID; only supplied fields change.                                                         |
| `delete_event`  | Delete an event by ID.                                                                                      |
| `search_events` | Search title, location, and description, optionally within a date range; results are ordered by start time. |

Event times use ISO 8601 with `Z` or an explicit UTC offset, such as
`2026-11-20T18:00:00-08:00`. Postgres stores start times as `timestamptz`,
and tool results return UTC timestamps. Date searches include `from` and
exclude `to`, making adjacent date ranges unambiguous.

## Project structure

```
neon/
├── neon.ts             # Neon Functions policy (defineConfig) — what gets deployed
├── drizzle.config.ts   # Drizzle Kit config (schema location + DB credentials)
├── tsconfig.json
├── .env.example        # Required environment variables
├── src/
│   ├── index.ts        # mcp-use server + tools (the function entry)
│   ├── env.ts          # Resolve the branch's DATABASE_URL
│   └── db/
│       ├── client.ts   # Shared pg pool and Drizzle client
│       └── schema.ts   # Drizzle schema (events table)
└── package.json
```

## Create a project

```bash
npx create-mcp-use-app neon-events --template neon
cd neon-events
```

## Install and update the Neon CLI to latest

```bash
npm i -g neon@latest
neon login
```

## Install dependencies

```bash
npm install
```

## Link your Neon project

Link (or create) a Neon project by running the `link` command from the workspace root:

```bash
neon link
```

`neon link` pulls your branch-scoped environment variables — including `DATABASE_URL` — into `.env.local`. You can also find your connection string in the [Neon Console](https://console.neon.tech).

## Apply the schema

Push the Drizzle schema to your Neon database:

```bash
npm run db:push
```

## Run locally

```bash
neon dev
```

This serves the function at `http://localhost:8787`, with the MCP endpoint at `http://localhost:8787/mcp`.

## Test the MCP server

Use the mcp-use client CLI included with this example. First, connect to the
local server and save it as `neon-events`, then list and call its tools:

```bash
# Connect and save the local server
npx mcp-use client connect neon-events http://localhost:8787/mcp

# List tools and inspect a tool's schema
npx mcp-use client neon-events tools list
npx mcp-use client neon-events tools describe create_event

# Create an event
npx mcp-use client neon-events tools call create_event \
  title="MCP Builders Meetup" startsAt="2026-11-20T18:00:00-08:00" \
  location="San Francisco" description="Meet other MCP builders"

# Search events by text and start-time range (omit filters to list all)
npx mcp-use client neon-events tools call search_events query="meetup" \
  from="2026-11-20T00:00:00-08:00" to="2026-11-21T00:00:00-08:00"

# Update an event (use id:=1 to pass a JSON number)
npx mcp-use client neon-events tools call update_event id:=1 location="Online"

# Delete an event
npx mcp-use client neon-events tools call delete_event id:=1
```

To add it to an MCP-aware client (Cursor, Claude Desktop, etc.), point the client at the `/mcp` URL as a streamable HTTP server. The quickest way is [`add-mcp`](https://www.npmjs.com/package/add-mcp), which writes the client config for you:

```bash
npx add-mcp http://localhost:8787/mcp -a cursor
```

Pass `-a <agent>` to target a specific client (e.g. `cursor`, `claude`); omit it to pick interactively. Swap in your deployed function URL once it's live.

## Deploy to Neon Functions

Deploy the MCP server as a Neon Function to your branch:

```bash
neon deploy
```

## Test your deployed function

Grab the function's invocation URL and connect your MCP client to its `/mcp` path:

```bash
# List the function to find its invocation URL
neon functions get events

# Then point an MCP client at it (replace with your URL)
npx mcp-use client connect neon-events-prod "https://<your-branch>-events.compute.<region>.aws.neon.tech/mcp"
npx mcp-use client neon-events-prod tools list
```

> A Neon Function has a **public HTTPS URL — it is reachable by anyone.** This example keeps things minimal and does not authenticate callers. Before exposing a real MCP server, verify a token/API key at the top of the handler (see the `neon-functions` skill after `neon init` or `neon skills`).

## Connect to Manufact by external URL

1. Open your organization in [Manufact](https://manufact.com).
2. Select **Servers → New Server → Connect an existing server**.
3. Paste the deployed Neon Function's full HTTPS `/mcp` URL.
4. Wait for successful discovery and connect the server.
5. Use the Inspector to call a tool, then run an eval or publishing check.

Neon continues to host the server and database. To add traffic analytics and sessions,
open the server's Settings and select **Upgrade to Manufact proxy**, then point
clients at the returned Manufact gateway URL. Calls sent directly to Neon do not
appear in gateway analytics.

See [Connect an existing server](https://docs.manufact.com/dashboard/connect-existing-server).
