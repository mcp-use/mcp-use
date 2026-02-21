# Deployment

Guide for deploying MCP servers to production.

## ⚠️ FIRST: Ensure the User is Logged In

**Before any deployment command, always verify authentication:**

```bash
mcp-use whoami
```

If this fails or the user has never logged in, run `mcp-use login` first — it opens a browser for OAuth.

---

## Quick Deploy (Manufact Cloud)

The fastest path to production — one command:

```bash
mcp-use deploy
```

Or via the npm script (pre-configured in all templates):

```bash
npm run deploy
```

Your server is live at `https://{slug}.run.mcp-use.com/mcp`.

---

## Prerequisites

Before running `mcp-use deploy`:

1. **Logged in** — run `mcp-use whoami` to verify, or `mcp-use login` if needed
2. **Git repository** — your project must be a git repo
3. **GitHub remote** — the `origin` remote must point to GitHub (SSH or HTTPS)
4. **Changes pushed** — deployment pulls from GitHub, not your local files. Commit and push first.
5. **GitHub App installed** — the mcp-use GitHub App must have access to the repo. The CLI will prompt you to install it if missing.

---

## Deploy Options

```bash
mcp-use deploy [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--name <name>` | Custom deployment name | `package.json` name or directory name |
| `--port <port>` | Server port | `3000` |
| `--runtime <runtime>` | `"node"` or `"python"` | Auto-detected from project files |
| `--env <KEY=VALUE>` | Set environment variable (repeatable) | — |
| `--env-file <path>` | Load env vars from a file | — |
| `--open` | Open deployment in browser after success | `false` |
| `--new` | Force a fresh deployment (ignore existing link) | `false` |

### Setting Environment Variables

```bash
# Inline
mcp-use deploy --env API_KEY=sk-xxx --env DATABASE_URL=postgres://...

# From file
mcp-use deploy --env-file .env.production
```

**NEVER commit secrets to git.** Use `--env` or `--env-file` for API keys, database URLs, and other sensitive values.

---

## Redeployment

After the first deploy, the CLI saves a link in `.mcp-use/project.json`. Subsequent `mcp-use deploy` calls **redeploy to the same URL** automatically.

To force a completely new deployment (new URL):

```bash
mcp-use deploy --new
```

---

## Managing Deployments

After deploying, manage your servers with `mcp-use deployments`:

```bash
# List all deployments
mcp-use deployments list

# View deployment details
mcp-use deployments get <id>

# View logs (build logs with -b, stream with -f)
mcp-use deployments logs <id>
mcp-use deployments logs <id> -b     # Build logs
mcp-use deployments logs <id> -f     # Stream live logs

# Restart (redeploy)
mcp-use deployments restart <id>

# Stop / start
mcp-use deployments stop <id>
mcp-use deployments start <id>

# Delete
mcp-use deployments delete <id>
```

### Managing Environment Variables on Running Deployments

```bash
# List current env vars
mcp-use deployments env list <id>

# Set env vars (triggers restart)
mcp-use deployments env set <id> API_KEY=sk-xxx DB_URL=postgres://...

# Remove env vars
mcp-use deployments env unset <id> API_KEY DB_URL
```

---

## Self-Hosting (Build + Start)

For deploying to your own infrastructure instead of Manufact Cloud:

### Build for Production

```bash
mcp-use build
```

This creates a `dist/` directory containing:
- Compiled TypeScript (`dist/index.js`)
- Built widgets (standalone HTML files)
- Static assets from `public/`
- Build manifest (`dist/mcp-use.json`)

**Build options:**
- `--with-inspector` — include the inspector UI in production
- `--inline` — inline all JS/CSS into widget HTML (needed for VS Code MCP Apps CSP)

### Start Production Server

```bash
mcp-use start
```

Runs `node dist/index.js` with `NODE_ENV=production`. Requires a prior `mcp-use build`.

**Start options:**
- `--port <port>` — override port (default: `3000`, respects `PORT` env var)
- `--tunnel` — expose via a public tunnel URL

### With PM2 (Process Manager)

```bash
mcp-use build
pm2 start "mcp-use start" --name my-mcp-server
```

### With Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t my-mcp-server .
docker run -p 3000:3000 my-mcp-server
```

---

## Common Mistakes

- ❌ Running `mcp-use deploy` without verifying auth first
  - ✅ Always run `mcp-use whoami` before deploying — run `mcp-use login` if needed
- ❌ Running `mcp-use deploy` with uncommitted/unpushed changes
  - ✅ The cloud builds from GitHub — always `git push` first
- ❌ Hardcoding secrets in code or committing `.env`
  - ✅ Use `--env` / `--env-file` flags, or `mcp-use deployments env set`
- ❌ Forgetting to install the mcp-use GitHub App on the repo
  - ✅ The CLI will prompt you, but you can also install it at `github.com/apps/mcp-use`
- ❌ Running `mcp-use start` without `mcp-use build` first
  - ✅ Always build before starting in production
- ❌ Using `verifyJwt: false` or `skipVerification: true` in production auth config
  - ✅ Those are development-only settings — always verify JWTs in production
