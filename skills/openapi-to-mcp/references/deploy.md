# Deploy to Manufact / mcp-use cloud

Once the inspector flow is solid, you need a public HTTPS URL so ChatGPT, Claude, or any other MCP host can reach the server. `mcp-use` ships with a deploy CLI that handles the build, container, and DNS in one command.

## Prerequisites

- GitHub repo. The current deploy flow needs a repo it can pull from. If the project isn't on GitHub yet:
  ```bash
  gh repo create <org>/<name> --private --source=. --push
  ```
- A Manufact / mcp-use account. The login command will prompt to create one if you don't have it.
- Secrets in your local `.env` so you can transcribe them to the dashboard later. **Don't push `.env`** — confirm it's in `.gitignore`.

## Deploy

The `blank` scaffold wires `npm run deploy` to the bundled `mcp-use deploy` CLI. Two commands:

```bash
npx mcp-use login    # one-time, or: npx @mcp-use/cli login on older scaffolds
npm run deploy       # wraps `mcp-use deploy`
```

> **Important:** `openapi.dereferenced.json` is generated locally and should be in `.gitignore`. The cloud build won't have it unless you generate it as part of the build. Before deploying, update the `build` script in `package.json` to run the spec deref step first:
>
> ```json
> "build": "tsx scripts/load-spec.ts && mcp-use build"
> ```
>
> This ensures the dereferenced file is always regenerated at build time on Manufact's side, even if it's not committed to the repo.

`deploy` will:

1. Push the latest commit to the configured branch (defaults to `main`).
2. Build the project on Manufact's side.
3. Spin up a container and route a subdomain to it.
4. Print the live URL — typically `https://<name>.run.mcp-use.com/mcp`.

If the build fails, the CLI prints the log URL. Most failures are missing env vars (no auth headers → 401 from upstream → tool errors → tests fail). The fix is in the next section.

## Set production env vars

The deployed container starts with no env vars. Open the project page in the Manufact dashboard (the deploy CLI prints the link) and set:

- `BASE_URL` — same as local, or a production-specific override.
- Whatever auth vars you used locally — `API_KEY`, `BEARER_TOKEN`, etc. Use **production** credentials, not your dev key.
- `PORT` — usually not needed; Manufact sets it automatically.

Restart the deployment after setting vars (the dashboard has a "Restart" button) or push a no-op commit.

Verify the deployed server is up:

```bash
curl https://<name>.run.mcp-use.com/mcp
```

A valid response is a JSON-RPC error like `{"jsonrpc":"2.0","error":{"code":-32600,"message":"..."}}` — that means the server is up and speaking MCP, it just didn't get a real request. A connection refusal or 502 means the container isn't running.

## Branch deploys

For experimenting without breaking the main URL, push to a non-main branch and run `npx @mcp-use/cli deploy --branch <branch>`. Each branch gets its own subdomain. Useful for testing changes against the live API before merging.

## Observability

The Manufact dashboard surfaces:

- **Logs** — every tool call, stdout, stderr.
- **Metrics** — request count, latency, error rate per tool.
- **Traces** — per-request span trees if you instrument with OpenTelemetry (out of scope for the first version).

Tail logs while you test the deployed server. If a tool call fails in production but worked locally, 9 times out of 10 it's a missing or stale env var.

## Install in ChatGPT (as a custom MCP connector)

1. `chatgpt.com` → **Settings** → **Apps** → **Advanced**.
2. Enable Developer mode if not already on.
3. **Create app** → fill Name, Description, and **MCP Server URL** (the `https://...run.mcp-use.com/mcp` URL from the deploy).
4. **Authentication**: if the MCP server is public (no MCP-level auth — the upstream API auth happens server-side via env vars), pick **No Auth**. The default OAuth option will fail with "MCP server does not implement OAuth" because your server is using env-var auth, not MCP OAuth.
5. Tick the consent checkbox, create the app.
6. Open a new chat: "Use the <app-name> app to call list_pets." If ChatGPT doesn't pick the app up automatically, click the **+** menu next to the input and select it explicitly.

Verify: the tool chip shows the call, the args, and a green check. The LLM summarizes the result. If you see CSP errors, this server has no widgets so CSP shouldn't matter — but if you do see them, check that Developer mode's "Enforce CSP" toggle matches your spec.

## Install in Claude

`claude.ai` → **Settings** → **Connectors** → **Add custom connector**. Same URL, same "No Auth" choice. Claude doesn't have the developer-mode toggle; the connector is immediately usable in any chat after you turn it on.

## Iteration after deploy

For most edits, push to `main` and `mcp-use` redeploys automatically (if you connected the repo via the dashboard's GitHub integration). If you deployed via the CLI without the integration, re-run `npm run deploy` after each commit.

Cache busting: if a tool definition changed and the inspector / ChatGPT shows the old one, fully reload the client. ChatGPT keeps tool schemas cached for a few minutes after a connector update.
