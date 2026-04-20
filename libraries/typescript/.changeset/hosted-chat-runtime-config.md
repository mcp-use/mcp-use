---
"@mcp-use/inspector": patch
---

feat(inspector): configure hosted chat URL at runtime via `MANUFACT_CHAT_URL`

The hosted chat endpoint (`chatApiUrl`) previously had to be baked into the client bundle at `vite build` time via `VITE_MANUFACT_CHAT_URL`. This prevented the same pre-built npm tarball from being configured per deploy (Railway, CDN, self-hosted) without a rebuild.

The inspector server now reads `MANUFACT_CHAT_URL` at runtime and injects `window.__MANUFACT_CHAT_URL__` into the served HTML. `InspectorProvider` prefers the runtime value and falls back to `VITE_MANUFACT_CHAT_URL` for local Vite dev, so existing build-time flows keep working.

Also drops `noopener` from the LoginModal OAuth popup and redirects the OAuth `callbackURL` to a new `/inspector/oauth-popup-closed.html` page so the popup self-closes cleanly instead of briefly loading the full inspector inside it.
