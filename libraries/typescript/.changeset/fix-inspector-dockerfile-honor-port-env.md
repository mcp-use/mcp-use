---
"@mcp-use/inspector": patch
---

Honor `$PORT` env var in the Inspector Docker image `CMD`.

The Dockerfile previously pinned the listen port to 8080 via `--port 8080`, contradicting the neighboring comment that said `$PORT` controls the actual port. Platforms that inject `PORT` and route traffic to it (Cloud Run, Railway, Heroku, Render, etc.) could not run `mcpuse/inspector` without an extra port-mapping layer.

The `CMD` now uses shell form with a default: `sh -c "npx @mcp-use/inspector --port ${PORT:-8080}"`. Behavior is unchanged when `PORT` is unset (still 8080).
