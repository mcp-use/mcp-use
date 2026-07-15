# React examples (`@mcp-use/client/react`)

## Prerequisites

```bash
# From packages/client
pnpm build

# Four demo servers (separate terminals)
cd examples/_demo-servers && pnpm install --ignore-workspace
PORT=3101 pnpm official:v1
PORT=3102 pnpm official:v2
PORT=3103 pnpm ours:v1
PORT=3104 pnpm ours:v2
```

## Run

```bash
cd examples/browser/react
pnpm install
pnpm dev
```

Routes:

| Path | Default target |
|------|----------------|
| `/` | `useMcp` → `http://127.0.0.1:3102/mcp` |
| `/multi-server` | all four servers; legacy + modern features and MCP Apps |
| `/dynamic-server` | add servers via URL input; OAuth Authenticate / Disconnect |
| `/oauth/callback` | OAuth redirect handler |

Override URL:

```bash
VITE_MCP_URL=https://mcp.linear.app/mcp pnpm dev
```

Vite proxies `/demo/mcp-use-v2` to port 3104 because the v2 reference server
validates browser origins but intentionally does not emit permissive CORS
headers.

## Build smoke

```bash
pnpm build && pnpm preview
```
