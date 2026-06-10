---
"@mcp-use/cli": patch
---

After a `--no-github` (platform-managed) deploy, print a short note explaining that the source lives in a private mcp-use-managed repository (no GitHub remote in the local folder) and link to the dashboard to view it or move it to your own GitHub. Aligns the CLI with the API, which no longer exposes the managed repo's `owner/repo` name.
