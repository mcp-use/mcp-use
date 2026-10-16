---
"@mcp-use/cli": minor
"create-mcp-use-app": minor
"mcp-use": minor
---

Customize the page a browser sees at the MCP URL with a `landing.tsx` in the MCP root. `mcp-use dev` and `mcp-use build` find it (also under `--mcp-dir`), and `mcp-use start` serves the built page. The page renders on the server and hydrates in the browser. Without `landing.tsx`, the built-in page is served as before.

- `mcp-use/landing` adds React-free hooks for the page: `useServerInfo()`, `useToolList()`, `usePromptList()`, `useResourceList()` and `useInstallTargets()`, with the `LandingServerInfo`, `InstallTargets` and per-client target types. Server info always ships to the page; each list ships only when a module in the `landing.tsx` import graph imports its hook, and a list hook without its data throws an error that says to import it.
- `getInstallTargets({ url, name })` returns the Claude Code, Cursor, VS Code, VS Code Insiders, ChatGPT and Manufact Inspector install links and commands, keyed by client, for use outside the server such as on a docs site. The built-in page now builds its links with it.
- `landing.tsx` can `export const metadata` (`LandingMetadata`: `title`, `description`, `icon`, `image`) to set the page title, meta description, and Open Graph and Twitter tags. Missing fields keep the server defaults.
- Tailwind classes work in `landing.tsx` with no CSS file, and CSS imports are bundled. In dev, edits use Fast Refresh, creating or deleting `landing.tsx` switches pages live, and a broken edit keeps serving the last working page. Builds honor `MCP_ASSETS_URL` for the page's assets.
- Every `create-mcp-use-app` template now includes a Tailwind-styled `landing.tsx` similar to the built-in page. The `blank` and `mcp-server` templates add `react`, `react-dom`, `@types/react` and `@types/react-dom`, and every template's `tsconfig.json` typechecks `landing.tsx`.
