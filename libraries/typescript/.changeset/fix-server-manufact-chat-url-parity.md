---
"@mcp-use/inspector": patch
---

fix(inspector): read `MANUFACT_CHAT_URL` in the standalone server entrypoint

The runtime hosted-chat URL injection was wired up in `cli.ts` (used by the published `mcp-inspect` bin and by Railway) but the same plumbing in `server.ts` (used by `pnpm start` / the dev server) was dropped during a merge. As a result, running the inspector via `node dist/server/server.js` with `MANUFACT_CHAT_URL` set did not inject `window.__MANUFACT_CHAT_URL__` into the served HTML.

This change restores parity between the two entrypoints so both honour the env var at process start.
