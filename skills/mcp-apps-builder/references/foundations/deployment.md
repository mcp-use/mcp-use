# Deployment

Guide for deploying MCP servers to production.

## ⚠️ FIRST: Ensure the User is Logged In

**Before any deployment command, always verify authentication:**

```bash
mcp-use whoami
```

If this fails or the user has never logged in, run `mcp-use login` first — it opens a browser for OAuth.

**Non-interactive / agent contexts:** if you were handed a one-time device code
(e.g. from the web onboarding flow), authenticate without a browser:

```bash
mcp-use login --device-code <CODE>
```

The code is short-lived and already approved, so the CLI redeems it immediately.

---

## Quick Deploy (Manufact Cloud)

There are two ways to deploy, depending on where the code should live.

### Option A — Managed repo (no GitHub required)

Best for getting live fast, or when the user hasn't connected GitHub. The CLI
uploads your local source; the repo is created in the platform-managed org and
deployed through the normal pipeline:

```bash
mcp-use deploy --no-github
```

No git remote, no GitHub App install. The user can later move it to their own
GitHub from the server's dashboard ("Connect your GitHub").

### Option B — Your own GitHub

Deploys from a repository in the user's GitHub account (enables push-to-deploy):

```bash
mcp-use deploy
```

Or via the npm script (pre-configured in all templates):

```bash
npm run deploy
```

Either way, your server is live at `https://{slug}.run.mcp-use.com/mcp`.

---

## Prerequisites

**No-GitHub deploy (`--no-github`)** only needs you to be **logged in** (`mcp-use whoami`).
No git, no GitHub App — the CLI uploads your local source directly.

**GitHub deploy** (`mcp-use deploy` without `--no-github`) additionally needs:

1. **Git repository** — your project must be a git repo
2. **GitHub remote** — the `origin` remote must point to GitHub (SSH or HTTPS)
3. **Changes pushed** — deployment pulls from GitHub, not your local files. Commit and push first.
4. **GitHub App installed** — the mcp-use GitHub App must have access to the repo. The CLI prompts you to install it if missing, or install it at `github.com/apps/mcp-use/installations/new`.

---

## Deploy Options

```bash
mcp-use deploy [options]
```

| Flag                  | Description                                                  | Default                               |
| --------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `--no-github`         | Upload local source without connecting GitHub                | `false`                               |
| `--org <slug>`        | Deploy to a specific organization (by slug or id)            | configured org                        |
| `--name <name>`       | Custom deployment name                                       | `package.json` name or directory name |
| `--port <port>`       | Server port                                                  | `3000`                                |
| `--runtime <runtime>` | `"node"` or `"python"`                                       | Auto-detected from project files      |
| `--env <KEY=VALUE>`   | Set environment variable (repeatable)                        | —                                     |
| `--env-file <path>`   | Load env vars from a file                                    | —                                     |
| `--open`              | Open deployment in browser after success                     | `false`                               |
| `--new`               | Force a fresh deployment (ignore existing link)              | `false`                               |
| `-y, --yes`           | Skip confirmation prompts (non-interactive / CI / agents)    | `false`                               |

> Redeploys of a platform-managed project are auto-detected from the linked server, so
> `--no-github` is only needed on the first deploy.

### Setting Environment Variables

```bash
# Inline
mcp-use deploy --env API_KEY=sk-xxx --env DATABASE_URL=postgres://...

# From file
mcp-use deploy --env-file .env.production
```

**NEVER commit secrets to git.** Use `--env` or `--env-file` for API keys, database URLs, and other sensitive values.

---

## Common Mistakes

- ❌ Running `mcp-use deploy` without verifying auth first
  - ✅ Always run `mcp-use whoami` before deploying — run `mcp-use login` if needed
- ❌ Running `mcp-use deploy` with uncommitted/unpushed changes
  - ✅ The cloud builds from GitHub — always `git push` first
- ❌ Hardcoding secrets in code or committing `.env`
  - ✅ Use `--env` / `--env-file` flags, or `mcp-use deployments env set`
- ❌ Forgetting to install the mcp-use GitHub App on the repo
  - ✅ The CLI will prompt you, but you can also install it at `github.com/apps/mcp-use` — or skip GitHub entirely with `mcp-use deploy --no-github`
- ❌ Running `mcp-use start` without `mcp-use build` first
  - ✅ Always build before starting in production
