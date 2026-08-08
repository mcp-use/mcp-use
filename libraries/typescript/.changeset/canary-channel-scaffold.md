---
"create-mcp-use-app": patch
---

Keep canary builds of the scaffolder on the canary channel. `getDefaultDistTag` only tested for `-beta.`, so `create-mcp-use-app@2.0.2-canary.0` resolved `mcp-use` from the `latest` dist-tag and cloned skills from `main`. A canary scaffold therefore pinned the stable framework instead of the matching canary release. `-canary.` versions now map to the `canary` dist-tag and the `canary` skills branch, the same way `-beta.` already mapped to beta.
