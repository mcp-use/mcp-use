# Public landing page

The MCP endpoint also serves an HTML landing page when a browser sends `Accept: text/html`.

```bash
pnpm dev
# visit http://127.0.0.1:3000/mcp in a browser
```

`publicLandingPage: true` only bypasses OAuth for that HTML navigation. MCP requests remain protected when OAuth is configured. The page lists the registered `greet` tool and provides connection instructions.
