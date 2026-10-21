---
"@mcp-use/inspector": patch
---

Pin native Railway builds to the Inspector version in the deployed commit and prevent prerelease versions from deploying from main. Publish and verify canary packages before pushing their version commit, replacing the custom Railway deployment action.
