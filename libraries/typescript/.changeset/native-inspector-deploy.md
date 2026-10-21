---
"@mcp-use/inspector": patch
---

Docker builds now default to the exact version in package.json, reject dist-tags and unpublished versions, and start the installed mcp-inspect binary directly while preserving PORT support. Native Railway deployments reject prerelease versions from main. Publish and verify canary packages before pushing their version commit, replacing the custom Railway deployment action.
