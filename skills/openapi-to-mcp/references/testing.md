# Testing the MCP server

The server uses streamable HTTP at `/mcp` (see SKILL.md step 8 for why this is non-negotiable). Two ways to test it, cheapest first. Run both before declaring the build done — each layer catches a different class of bug.

## Table of contents

1. Start the dev server
2. Layer 1 — `mcp-use client` CLI (primary)
3. Layer 2 — inspector chat (LLM loop)
4. Testing the deployed URL
5. Raw protocol debugging (curl)
6. Common failures and fixes
7. What "done" looks like

---

## 1. Start the dev server

From the project root:

```bash
# Make sure .env has the right secrets (and is gitignored)
cp .env.example .env
$EDITOR .env

# If you changed openapi.yaml since last time, refresh the dereferenced file
npx tsx scripts/load-spec.ts   # or: npm run load-spec (add "load-spec": "tsx scripts/load-spec.ts" to package.json scripts)

# Start hot-reload dev server
rm -rf .mcp-use dist        # only if you've moved files or are seeing stale-cache errors
npm run dev
```

Watch the log. You should see:
- The list of tools registered (one per operation, after any filter you applied).
- The port the server is listening on (3000, or 3001 if 3000 is taken).
- Both the MCP URL (`http://localhost:<port>/mcp`) and the inspector URL.

If you don't see your tool list, you missed a step in the operations loop in `index.ts` (e.g., the filter skipped everything, or `openapi.dereferenced.json` is missing).

## 2. Layer 1 — `mcp-use client` CLI (primary)

The `mcp-use` package ships a CLI client that connects to any streamable-HTTP MCP server, handles session and auth bookkeeping, and gives a clean `tools list` / `tools call` / `interactive` surface from the terminal. This is the first thing to reach for. Full docs at <https://docs.mcp-use.com/typescript/client/cli>.

### Connect once, then run commands against the name

```bash
# Save the dev server under a short name (only once per server)
npx mcp-use client connect dev http://localhost:3000/mcp

# List saved servers
npx mcp-use client list
```

The server is persisted in `~/.mcp-use/cli-sessions.json` so the name is reusable across shells.

### List and describe tools

```bash
npx mcp-use client dev tools list
npx mcp-use client dev tools list --json

# Describe shows the zod-derived input schema for one tool — useful for debugging args
npx mcp-use client dev tools describe <tool_name>
```

If `tools list` is empty, your operation filter killed everything. Check `index.ts`.

### Call tools

```bash
# Simple args (string, number, bool inferred from schema)
npx mcp-use client dev tools call list_pets limit=5

# Pass JSON for nested objects or arrays
npx mcp-use client dev tools call create_pet '{"name":"Felix","tags":["cat","stripey"]}'

# Or use the typed-JSON arg syntax
npx mcp-use client dev tools call create_pet name=Felix tags:='["cat","stripey"]'

# Long-running calls — pump the timeout
npx mcp-use client dev tools call slow_op --timeout 60000
```

Add `--json` to any call to get raw JSON output for piping into `jq` or further scripts.

### REPL mode

```bash
npx mcp-use client dev interactive
```

Drops you into a prompt where every command is in the context of the `dev` server. Useful when iterating on schema or response shape — you can list, describe, and call without retyping the server name each time.

### Authentication

If your MCP server itself enforces auth (different from upstream API auth — most OpenAPI wrappers don't), the CLI supports static bearer tokens (`--auth <token>` at connect time) and a full OAuth flow. For OpenAPI wrappers built with this skill, auth lives in `process.env` and is attached server-side to the upstream calls; the MCP server itself is unauthenticated and the CLI just connects directly.

### When the CLI itself fails

Two common cases:
- **`Error: Client 'dev' not found`** — you forgot to `connect` first, or the saved sessions file got corrupted. Re-run `connect`.
- **Connection refused / timeout** — the dev server isn't running, or it's on a different port (check the dev log). If the dev server is running and the CLI still can't connect, drop to curl (section 5) to confirm the endpoint is alive and speaks MCP at all.

For scripted / CI use, add `--json` to any CLI command and pipe to `jq`:

```bash
npx mcp-use client dev tools list --json | jq '.[].name'
npx mcp-use client dev tools call list_pets limit=5 --json | jq '.content[0].text'
```

That covers the "scriptable" case without a separate test file.

## 3. Layer 2 — inspector chat (the real LLM loop)

Layer 1 proves the server works. Layer 2 proves the LLM can actually use it. This is the one that catches description / schema problems the CLI can't see.

### Open the inspector

```
http://localhost:<PORT>/inspector?server=http%3A%2F%2Flocalhost%3A<PORT>%2Fmcp&tab=chat
```

The `server` query string is URL-encoded. Without encoding, the inspector connects to nothing and silently shows zero tools. You can also open `http://localhost:<PORT>/inspector` plain and paste the MCP URL into the connection input.

### Two test phases

**Force-invoke (low difficulty).** Ask the model to call a specific tool by name:

> Use `list_pets` with `limit: 5`.

This isolates tool-execution correctness from tool-selection correctness. If this fails, fix the tool before moving on. You should already have caught it in Layer 1, but the inspector adds an LLM in the path that occasionally exposes argument-coercion quirks the CLI doesn't.

**Free-form discovery (real-world difficulty).** Describe the goal in natural language and let the LLM pick:

> Show me the first 5 pets in the store.

The LLM should land on the right tool based on the description and schema alone. If it picks the wrong tool or hands wrong-shaped args, the OpenAPI `summary` / `description` aren't carrying enough signal — improve them in `openapi.yaml`, re-run `npm run load-spec`, restart the dev server.

### What to verify

1. **Tool chip** — green check, args match what you asked.
2. **Auth was sent** — set `DEBUG_HTTP=1` in `.env` for the session if you need to see it in the log. The redaction in `client.ts` keeps the secret out of the log; the presence of the header proves it was sent.
3. **Response shape** — parsed JSON or a useful string, not raw HTML or a 500-page error blob.
4. **LLM follow-up** — the model summarizes the response correctly. If it's hallucinating fields that aren't in the response, your tool description or output schema needs to be tighter.

### Failure paths to test in the inspector

- **Missing required arg.** Ask for a call without a required field. The zod schema should reject it client-side; the chip shows the validation error.
- **Bad auth.** Unset `API_KEY` (or set it to garbage) and restart. The tool should return `Error calling X: HTTP 401 ...` — not crash the server.
- **Dead endpoint.** Temporarily point `BASE_URL` at `http://localhost:9999` (nothing listening). The tool returns a clean fetch error.

## 4. Testing the deployed URL

After step 10 (deploy), both layers apply — just point them at the production URL.

```bash
# Layer 1 — CLI (just connect to the production URL under a new name)
npx mcp-use client connect prod https://<name>.run.mcp-use.com/mcp
npx mcp-use client prod tools list
npx mcp-use client prod tools call <tool> limit=5

# Layer 2 — online inspector
# Visit https://inspector.mcp-use.com and paste the production /mcp URL.
```

If layer 1 passes locally but fails against production, the issue is almost always missing or stale env vars in the Manufact dashboard (see `references/deploy.md`).

## 5. Raw protocol debugging (curl)

When the CLI can't connect and you need to know whether the streamable-HTTP endpoint is alive at the transport layer, drop to curl. This is for diagnosing transport-level issues only — the CLI is faster for everything else.

```bash
# Initialize a session and grab the Mcp-Session-Id header
SESSION=$(curl -s -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-debug","version":"1.0"}}}' \
  | grep -i "mcp-session-id:" | awk '{print $2}' | tr -d '\r')
echo "Session: $SESSION"

# List tools
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

What to look for:

- **Empty `SESSION`** → server didn't respond with an `Mcp-Session-Id` header. Server isn't running, wrong port, or — uncommonly — the transport got swapped to stdio. Verify `server.listen(port)` is the last line of `index.ts`.
- **Connection refused** → port not listening.
- **`{"jsonrpc":"2.0","error":...}` on initialize** → server is up but the request was malformed (most often a missing Accept header).
- **Successful initialize + empty tools/list** → server is up, transport is fine, but the operations loop filtered everything out.

The response body for streamable HTTP is SSE-encoded (lines prefixed with `data:`). That's normal — the CLI and SDK both parse it transparently.

## 6. Common failures and fixes

**`"Failed to resolve import /sessions/... index.ts"`** — Stale `.mcp-use` cache from a previous mount or path. `rm -rf .mcp-use && npm run dev`.

**Inspector says "0 tools available"** — Two causes: (a) the operations loop filtered everything out — check the filter constants in `index.ts`; (b) the URL encoding in the inspector query string is wrong — re-paste using the URL-encoded form above.

**Tool call returns `Error: Unknown operation: X`** — `src/client.ts` couldn't find the operation in the dereferenced spec. Probably means `openapi.dereferenced.json` is stale (you edited `openapi.yaml` without running `npm run load-spec`).

**LLM never calls the right tool (only fails in Layer 2)** — Description is too thin. Layer 1 can't see this; it doesn't reason about tool selection. Open `src/operations.ts` and verify the description-building falls back to something meaningful when `summary` is empty. Adding a one-line example to the spec's `description` for that operation often fixes it.

**LLM calls the tool with wrong types** — A field in the zod schema doesn't have `.describe()` or its enum values aren't in the description. Check `references/mapping-rules.md` section 4.

**401 even though `.env` has the key** — dotenv isn't being loaded. Add `import "dotenv/config"` at the top of `index.ts` (the template does this); make sure `npm i dotenv` ran. Or run the server with `node --env-file=.env`.

**CLI says "Client 'dev' not found"** — You haven't run `connect` for that name, or the saved sessions file at `~/.mcp-use/cli-sessions.json` got cleared. Re-run `npx mcp-use client connect dev http://localhost:3000/mcp`.

## 7. What "done" looks like

Before moving on to deploy:

- Layer 1 (CLI): `connect` succeeds; `tools list` shows every expected tool; `tools call` returns a real or cleanly-erroring result for at least one tool.
- Layer 2 (inspector): every tool you care about has been force-invoked successfully **and** at least one has been called via free-form discovery.
- At least one tool has been called with an unhappy-path input (missing arg, bad auth, dead upstream) and returned a structured error in both layers.
- The dev server log shows no warnings about unknown schemes or missing operations.
- `npx tsc --noEmit` passes.

Once that's green, jump to `references/deploy.md`.
