---
"create-mcp-use-app": patch
---

Clean up create-mcp-use-app template dependencies

- Remove unused deps from blank and starter templates: @openai/apps-sdk-ui, @tanstack/react-query, cors, express
- Remove build tool devDeps from all 3 templates (vite, @vitejs/plugin-react, @tailwindcss/vite) — these are provided by @mcp-use/cli
- Remove cargo-culted overrides (sugarss, lodash) from all 3 templates — no longer needed, zero audit vulnerabilities without them
