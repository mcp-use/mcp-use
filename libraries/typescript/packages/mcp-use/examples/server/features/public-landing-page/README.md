# Public Landing Page Example

An OAuth-protected MCP server that keeps its browser landing page public.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/mcp` in a browser to view the landing page without
authentication.

Use the mcp-use inspector to connect to `http://localhost:3000/mcp` and try the
protected MCP server. Use `demo-token` as the bearer token, or set
`DEMO_ACCESS_TOKEN` before starting the server.
