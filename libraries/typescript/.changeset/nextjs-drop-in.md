---
"mcp-use": minor
"@mcp-use/client": patch
---

Ship a Next.js drop-in adapter and harden sandbox view loading in the React client.

**mcp-use**

- Add `mcp-use/next` with `withMcpUse` and `createNextHandler` so MCP servers can mount inside Next.js App Router projects.
- Teach `mcp-use dev` / `mcp-use build` to discover `--mcp-dir` / `--views-dir`, load Next-style `.env*` files, and shim Next server-only modules when building standalone from a Next host.
- Add Next.js drop-in and standalone examples plus CI verification for the example suite.

**@mcp-use/client**

- Load blob sandboxes via `iframe.srcdoc` and delay blob URL revocation so React StrictMode remounts do not break view rendering.
