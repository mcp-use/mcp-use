---
"@mcp-use/cli": patch
---

Derive `buildId` from view content so identical builds produce the same URI.

Previously `runBuild` generated a random hex ID on every run, which rotated all
view URIs on every deploy even when no view changed. Now the ID is a truncated
SHA-256 of the views manifest, so a backend-only redeploy keeps existing URIs
stable.

Also adds `MCP_USE_BUILD_ID` environment variable and `--build-id <id>` CLI
flag for pinning the ID to a git SHA or release tag.
