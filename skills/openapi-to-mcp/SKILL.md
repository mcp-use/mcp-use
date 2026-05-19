---
name: openapi-to-mcp
description: Build and deploy an MCP server from an OpenAPI / Swagger spec using the mcp-use TypeScript SDK. Use this skill whenever the user wants to "turn this OpenAPI spec into an MCP server", "make this API usable from Claude/ChatGPT", "wrap this Swagger doc as MCP tools", "expose this REST API to an LLM", "generate MCP tools from a spec", or pastes/attaches an `openapi.yaml`, `openapi.json`, or `swagger.json` and asks for a Claude-compatible version. Trigger even if the user doesn't say "MCP" — if they describe an existing HTTP API (REST endpoints, an internal service, a third-party API they have a key for) and want an LLM to call it, this is the right skill. Covers spec ingestion (file path, URL, or pasted), operation-to-tool mapping, auth wiring (apiKey, bearer, basic, OAuth bearer), scaffolding with `create-mcp-use-app`, tool generation with proper zod schemas, live testing in the mcp-use inspector, and deploying to Manufact / mcp-use cloud.
---

# Build an MCP server from an OpenAPI spec

Turn an existing REST API — described by an OpenAPI 3.x or Swagger 2.0 document — into an MCP server. Each operation in the spec becomes one MCP tool the LLM can call. The server runs locally for testing and ships to Manufact / mcp-use cloud with one command.

This skill is the end-to-end recipe: scope → ingest spec → map operations → scaffold → generate tools → wire auth → test → deploy.

## Core philosophy: the spec is the contract

The OpenAPI document is the source of truth. Tool names, descriptions, parameter shapes, and auth requirements all come from the spec — they should not be invented. This matters because:

- **The LLM trusts descriptions.** If the spec says `summary: "Get current weather for a city"`, that's exactly what the LLM will read when deciding whether to call the tool. Hand-rolled summaries drift; spec-derived summaries stay in sync if the API changes.
- **Zod schemas mirror OpenAPI schemas.** Every parameter — path, query, body — becomes a field in one zod object. Required/optional, enums, min/max, and descriptions all carry over. The LLM uses the schema to figure out what to ask the user for.
- **Auth lives outside the spec.** OpenAPI declares the auth scheme but never the secret. Secrets come from env vars; the spec tells you which env vars to require.

When in doubt, prefer mechanical fidelity to the spec over creativity. The LLM is doing the creative part — talking to the user — and only needs a faithful, well-typed handle on the API.

## Process

### 1. Scope the request (use AskUserQuestion)

Before writing code, lock five things via the `AskUserQuestion` tool. All five are about the API and what to build — deployment is a separate question we ask later in step 10, when the user can actually evaluate it against a working server.

- **Spec source**: a file path in the workspace, a URL (e.g., `https://api.example.com/openapi.json`), or pasted into chat. If pasted, save it to `openapi.yaml` or `openapi.json` first.
- **Server base URL**: take it from `servers[0].url` in the spec if present; otherwise ask. Multiple `servers` entries are common (prod / staging) — confirm which one.
- **Auth scheme**: read `components.securitySchemes`. If multiple, ask which to use. If the API needs an API key or token, ask which env var should hold it (`API_KEY`, `OPENAI_API_KEY`, etc.). Don't ask for the secret itself — never put it in the conversation or commit it.
- **Operation filter**: large specs (Stripe, GitHub) have hundreds of endpoints. Ask whether to expose all operations, a tag (`pets`, `users`), or a hand-picked list. Default to "all" for specs under ~30 operations; ask above that. See `references/mapping-rules.md` for filtering patterns.
- **Widgets**: ask whether any operations should render a widget in the chat (a React component shown inline next to the LLM's reply), or whether this is a pure tools-only server. The default for an OpenAPI wrapper is **tools-only** — the LLM reads JSON and talks. Pick widgets only when the user wants a richer UI for specific responses (a map for a geocoding endpoint, a chart for a metrics endpoint, a card list for a search result). **This answer drives the scaffold template in step 3**: tools-only → `--template blank`, any widgets → `--template mcp-apps` (which ships the `resources/` widget infrastructure pre-wired). If the user wants widgets on most operations, the `build-mcp-app` skill is usually a better fit than this one — flag that and confirm before proceeding.

Don't skip this step. Generating 200 tools the user doesn't need pollutes the LLM's tool list and slows it down.

### 2. Acquire and dereference the spec

Get the spec into a single dereferenced JSON object on disk. Dereferencing inlines `$ref`s so downstream code never has to chase pointers.

```bash
# In the scaffolded project root
npm install @apidevtools/swagger-parser
```

```ts
// scripts/load-spec.ts (run once, manually or as a build step)
import SwaggerParser from "@apidevtools/swagger-parser";
import { writeFileSync } from "node:fs";

const spec = await SwaggerParser.dereference("./openapi.yaml");
writeFileSync("./openapi.dereferenced.json", JSON.stringify(spec, null, 2));
```

For URL specs, swagger-parser accepts the URL directly. For pasted YAML, write it to `openapi.yaml` first, then dereference. If the spec is Swagger 2.0, run it through `swagger2openapi` first (`npx swagger2openapi --outfile openapi.yaml swagger.yaml`).

Sanity-check the dereferenced file: open it, search for `"$ref"` — there should be none. If there are, the spec has circular refs and swagger-parser keeps them as-is; treat those refs as opaque object types in zod.

### 3. Scaffold with `create-mcp-use-app`

Pick the template based on the widget answer from step 1:

```bash
# Tools-only (the default for an OpenAPI wrapper)
npx create-mcp-use-app@latest <project-name> --template blank

# Any widgets at all
npx create-mcp-use-app@latest <project-name> --template mcp-apps
```

Let the scaffold install dependencies and `git init` — both are useful (`npm install` runs `mcp-use generate-types` postinstall, and a git repo is required by `npm run deploy` later). The skill installs companion coding-agent skills by default too; that's fine.

Verify the template catalog with `npx create-mcp-use-app@latest --list-templates` if it's been a while — the available set is `blank`, `starter`, `mcp-apps` as of this writing. `starter` includes sample tools you'd rip out, so we don't recommend it here.

After scaffolding, add the two extra deps the OpenAPI flow needs:

```bash
cd <project-name>
npm install @apidevtools/swagger-parser dotenv
```

What you get from `blank` (`mcp-apps` is a superset with `resources/` + widget infrastructure):

- `index.ts` at the root with a configured `MCPServer` instance — `name`, `title`, `version`, `description`, `baseUrl`, `favicon`, and an `icons[]` array. Commented-out examples for tools, resources, and prompts. Listens on `process.env.PORT` (default 3000).
- `package.json` with scripts wired to the `mcp-use` CLI: `dev` (hot reload + inspector), `build`, `start`, `deploy`. `tsx`, `zod`, and `typescript` are already in dev/regular deps; don't reinstall them.
- `tsconfig.json` pre-configured for ESM (`"type": "module"`).
- `public/` with a favicon and an SVG icon — served as static assets.
- A `.git` directory and an initial commit.

The scaffold reserves the env var `MCP_URL` for the **MCP server's own public base URL** (used for widget asset URLs and similar). That is *not* the upstream API's base URL — name your upstream var `BASE_URL` (or `API_BASE_URL` if you want to be explicit) to avoid stepping on it.

### 4. Plan project structure

Keep the tree shallow and predictable. The point is that someone reading the project for the first time can find the OpenAPI client, the tool wiring, and the auth in three obvious files.

```
<project>/
├── index.ts                         # MCPServer + server.tool() registration loop
├── openapi.yaml                     # The original spec (committed)
├── openapi.dereferenced.json        # Dereferenced spec (gitignored; regenerated)
├── src/
│   ├── client.ts                    # fetch-based HTTP client (base URL + auth + error handling)
│   ├── auth.ts                      # Reads env vars, builds the auth header
│   ├── operations.ts                # Loads dereferenced spec, exposes operation metadata
│   └── schema.ts                    # OpenAPI schema → zod converter
├── scripts/
│   └── load-spec.ts                 # Dereference helper (step 2)
├── .env.example                     # Document required env vars (API_KEY, BASE_URL, etc.)
└── package.json
```

For tiny specs (<10 operations) you can inline `client.ts`, `auth.ts`, and `operations.ts` into `index.ts`. For anything bigger, split — the LLM works better when each file has one job.

### 5. Map operations to tools

For every operation in the spec, you produce one `server.tool({...}, handler)` call. The mapping is mechanical:

| OpenAPI field | MCP tool field |
|---|---|
| `operationId` (preferred) or `${method}_${path}` sluggified | tool `name` (snake_case) |
| `summary` + `description` | tool `description` |
| `parameters` (path + query) + `requestBody.content."application/json".schema` | merged zod object → tool `schema` |
| `responses.200.content."application/json".schema` | optional zod object → tool `outputSchema` |
| `security` (or root-level fallback) | which auth headers the handler attaches |

Read `references/mapping-rules.md` for the full rules — including how to name tools when `operationId` is missing, how to handle `oneOf` / `anyOf` / nullable types in zod, how to flatten multi-content request bodies, and how to deal with the response-shape gotchas (binary downloads, streaming, paginated lists).

### 6. Generate the zod schemas

OpenAPI types map to zod as follows. The full converter lives in `src/schema.ts` — see `references/code-templates.md` for the implementation. Key choices:

- `type: string` with `enum` → `z.enum([...])`. Use the OpenAPI `description` as the `.describe()` arg so the LLM sees it.
- `type: integer` / `type: number` → `z.number().int()` / `z.number()`. Carry over `minimum`, `maximum`, `multipleOf`.
- `type: array` → `z.array(<itemType>)`. If `minItems` / `maxItems` exist, chain `.min()` / `.max()`.
- `type: object` → `z.object({...})`. Required props are non-optional; others wrap in `.optional()`.
- `oneOf` / `anyOf` → `z.union([...])`. `allOf` with object-only members → merge into one `z.object`.
- `nullable: true` (OpenAPI 3.0) or `type: ["string", "null"]` (3.1) → `.nullable()`.

Always call `.describe(openapi.description ?? openapi.summary ?? "")` on every field so the LLM gets human-readable hints when filling args.

### 7. Build the HTTP client and auth layer

`src/client.ts` exposes one function: `callOperation(operationId, args) → Promise<unknown>`. Internally it:

1. Looks up the operation in the dereferenced spec.
2. Substitutes path params into the URL template (`/users/{id}` + `{id: 42}` → `/users/42`).
3. Appends query params as `?key=value`.
4. Adds auth headers from `src/auth.ts`.
5. Serializes the request body as JSON (or `application/x-www-form-urlencoded` if the spec says so).
6. Sends the request; throws on non-2xx with the server's error body included.
7. Returns parsed JSON (or text, for non-JSON responses).

`src/auth.ts` reads from `process.env` based on the spec's `securitySchemes`. See `references/auth.md` for the four common schemes and how each becomes a header. Required env vars belong in `.env.example` — that's the contract for whoever runs the server later.

### 8. Wire tools in `index.ts`

The registration loop is small. Pseudocode:

```ts
import "dotenv/config";
import { MCPServer, text } from "mcp-use/server";
import { operations } from "./src/operations";
import { callOperation } from "./src/client";
import { operationToZod } from "./src/schema";

// Keep the MCPServer fields the scaffold gave you (title, baseUrl, favicon, icons).
// Just adjust `name`, `title`, and `description` to match the API you're wrapping.
const server = new MCPServer({
  name: "<api-name>",
  title: "<API name>",
  version: "1.0.0",
  description: "MCP server wrapping the <API name> REST API",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
  favicon: "favicon.ico",
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["512x512"] }],
});

for (const op of operations) {
  server.tool(
    {
      name: op.toolName,
      description: op.description,
      schema: operationToZod(op),
    },
    async (args) => {
      const result = await callOperation(op.operationId, args);
      return text(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    },
  );
}

// Streamable HTTP transport — the only supported transport for this skill.
// MCP endpoint: POST http://localhost:<port>/mcp
// Inspector:    http://localhost:<port>/inspector
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(PORT);
```

**Transport must be streamable HTTP, not stdio.** mcp-use's `server.listen(port)` sets up the streamable-HTTP transport at `/mcp` — that's the right choice for every server this skill generates. Don't substitute stdio. Stdio servers can't be deployed to Manufact / mcp-use cloud (cloud needs an HTTP endpoint to route traffic to), can't be tested with the online inspector, can't be installed as a custom connector in ChatGPT or Claude (both connect over HTTPS), and can't be hit with the curl tests in `references/testing.md`. Stdio is for local CLI-tool MCP servers, which is not what we're building here.

Full templates for each file in `references/code-templates.md`.

### 9. Test the server

Start the dev server first — every test in this step assumes it's running:

```bash
npm run dev
```

The log prints the port (default 3000, falls back to 3001 if taken), the MCP URL (`http://localhost:<port>/mcp`), and the inspector URL. Leave this running in one terminal; use a second terminal for the test commands below.

Then test in two layers. Don't claim "done" until both pass. Full recipes in `references/testing.md`.

**Layer 1 — `mcp-use client` CLI.** This is the first thing to reach for. The mcp-use package ships a CLI that talks streamable HTTP, handles session/auth bookkeeping, and gives a `tools list` / `tools call` / `interactive` loop straight from the terminal. No code, no curl arithmetic.

```bash
# Save the dev server under a short name
npx mcp-use client connect dev http://localhost:3000/mcp

# List and describe tools
npx mcp-use client dev tools list
npx mcp-use client dev tools describe <tool_name>

# Call a tool — args are key=value, or pass JSON for complex shapes
npx mcp-use client dev tools call <tool_name> limit=5
npx mcp-use client dev tools call <tool_name> '{"limit": 5, "filter": "active"}'

# REPL mode for fast iteration
npx mcp-use client dev interactive
```

For CI / scripted tests, add `--json` and pipe to `jq`. If `tools list` returns nothing, your operation filter in `index.ts` killed everything or `openapi.dereferenced.json` is missing. If `connect` itself fails, the dev server isn't running or it's on a different port — drop to curl (see `references/testing.md` section "Raw protocol debugging") to confirm the endpoint is alive at all.

**Layer 2 — Inspector chat (the real LLM loop).** Layer 1 proves the server works. The inspector proves the **LLM can use it** — that the tool description is descriptive enough for the model to pick the right tool, that the zod schema has enough hints to fill args correctly, that the response shape isn't so weird the model can't summarize it.

```
http://localhost:<PORT>/inspector?server=http%3A%2F%2Flocalhost%3A<PORT>%2Fmcp&tab=chat
```

Test both force-invocation ("Use `list_pets` with limit 5.") and free-form discovery ("Show me the first 5 pets in the store.") — the second is harder and the one that catches description quality.

Test the failure paths in both layers: missing required arg (zod rejection), wrong auth (upstream 401), upstream 5xx (point `BASE_URL` at a dead port). Both layers should degrade with a clean error, not a server crash.

If you see "Failed to resolve import" or stale tool definitions in either layer: `rm -rf .mcp-use && npm run dev`.

### 10. Deploy (ask the user)

The server works locally. Now ask, via `AskUserQuestion`, whether to deploy it to mcp-use cloud or keep it local. Two options only — no need to enumerate alternatives:

- **Deploy to mcp-use cloud** — publishes the server at a `https://<name>.run.mcp-use.com/mcp` URL usable from ChatGPT, Claude, and any MCP client. Best when the server will be used by anyone other than the developer's own dev machine.
- **Keep local** — hand back the dev-server URL and stop. Best for prototyping against an internal API, or when the user wants to evaluate the output before committing to a public URL.

If the user picks **keep local**, you're done — give them the inspector and `/mcp` URLs from step 9 and skip the rest of this step. Don't push deploy; premature deploys leak credentials and create stale public endpoints.

If the user picks **deploy**, the `blank` scaffold already wires `npm run deploy` to `mcp-use deploy`. Two commands once they're logged in:

```bash
npx mcp-use login
npm run deploy
```

This currently requires a GitHub repo. If the project isn't on GitHub yet:

```bash
gh repo create <org>/<name> --private --source=. --push
```

After deploy you get a URL like `https://<name>.run.mcp-use.com/mcp`. Set the same env vars in the Manufact dashboard (the deploy CLI prints the link to the project page) so the production server has the same auth as your local one.

Full deploy walkthrough — including how to wire env vars in the dashboard, how to view logs, and how to set up branch deploys — is in `references/deploy.md`.

### 11. Ship checklist

Before declaring done:

- `.env.example` lists every required env var with a short comment.
- `openapi.dereferenced.json` is in `.gitignore` (regenerate from `openapi.yaml`).
- `npm run build` passes; `npx tsc --noEmit` is clean.
- The inspector ran every tool you care about against the live API at least once.
- The deployed URL responds to `curl https://<name>.run.mcp-use.com/mcp` with a valid MCP response.
- Commit and push.

## Critical reference material

Read these when the relevant step lands. Each file is a focused deep-dive — don't load them all upfront.

- `references/mapping-rules.md` — Operation-to-tool mapping rules: naming, parameter merging, response handling, schema edge cases (oneOf/anyOf/allOf, nullable, recursive refs), filtering large specs.
- `references/code-templates.md` — Copy-ready skeletons for `index.ts`, `src/client.ts`, `src/auth.ts`, `src/operations.ts`, `src/schema.ts`, `scripts/load-spec.ts`, `.env.example`, and `tsconfig.json`. Each is annotated.
- `references/auth.md` — The four common auth schemes (apiKey, http bearer, http basic, OAuth2 bearer) and how each becomes a header. Includes the OAuth-with-refresh-token pattern.
- `references/testing.md` — Inspector recipe, the `.mcp-use` stale-cache trap, how to force-invoke a tool, what to check in tool responses, common 4xx/5xx debugging.
- `references/deploy.md` — `mcp-use deploy`, GitHub setup, env vars in the Manufact dashboard, branch deploys, observability tabs, and how to install the deployed URL as a custom MCP connector in ChatGPT or Claude.

## Trigger words and aliases

Use this skill whenever the user says anything in the cluster:

- "build an MCP server from this OpenAPI spec / Swagger doc"
- "turn this API / swagger.json / openapi.yaml into MCP tools"
- "wrap [API name] as an MCP server"
- "make [Stripe / GitHub / our internal API] callable from Claude"
- "expose these endpoints to an LLM"
- "I have an OpenAPI spec, generate the MCP server"
- Pastes or attaches a `.yaml` / `.json` spec and asks for an MCP version
- Describes an existing REST API (with a key, base URL, or docs link) and wants LLM access

## When NOT to use this skill

- The user wants a **widget-driven MCP App** where most/every tool renders a custom UI in the chat → use `build-mcp-app` instead. This skill can layer a widget on one or two specific tools, but if widgets are the whole point, the other skill is the right starting frame. Confirm with the user during step 1.
- The user has no API yet and wants to **design one** from scratch → that's an API-design task, not an MCP-wrapping task.
- The user wants to **consume** an MCP server as a client (not build one) → different skill / not this one.
- The spec is for a **GraphQL** or **gRPC** service, not OpenAPI → this skill is OpenAPI-specific; the patterns transfer but the schema converter doesn't.
