---
"mcp-use": patch
---

fix(react): `useWidget` no longer flips `isPending` to `false` before real props arrive (#1753)

Two pre-render paths in `useWidget` were causing widgets to render with empty props, which crashed any widget that destructured required fields (e.g. `markers.length`, `results.length`, `center.lat`) after the `isPending` guard.

- **ChatGPT Apps provider** — `isPending` compared `openaiToolOutput === null && toolResponseMetadata === null`, but `useOpenAiGlobal` returns `undefined` before the host has populated the key. `undefined === null` is `false`, so `isPending` was `false` on the very first render. Now uses loose `== null` so `undefined` is treated the same as `null`.
- **mcp-ui URL-params fallback** — the fallback `urlParams` memo defaulted to `{ toolInput: {}, toolOutput: {}, toolId: "" }`, so the subsequent `toolOutput === null || toolOutput === undefined` check never triggered during standalone (non-iframe) dev. The memo now distinguishes "no `mcpUseParams` supplied" from "tool completed with empty object" via a `hasMcpUseParams` flag, and `isPending` stays `true` until params actually arrive.
