---
"mcp-use": patch
---

fix(inspector): scope OAuth proxy fetch per server configuration

The browser OAuth provider previously installed a global `window.fetch`
interceptor to route OAuth requests through the inspector proxy. With multiple
servers, connecting one server "Via Proxy" mutated `fetch` for the entire page,
so other servers (including ones set to "Direct") and unrelated requests were
affected, and switching a server from "Via Proxy" back to "Direct" could leave a
stale interceptor behind.

`BrowserOAuthClientProvider` now exposes a scoped `getProxyFetch()` that returns
a `fetch` confined to a single provider. It is passed only to that server's SDK
transport and `auth()` calls (via the SDK's `fetch` / `fetchFn` options), so
OAuth-proxy behavior is scoped to the selected server's connection and the
global `fetch` is never mutated.
