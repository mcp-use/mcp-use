---
"create-mcp-use-app": patch
---

Replace `--canary` with `--sdk-version <version>` so new projects can pin `mcp-use` to any npm dist-tag or semver (e.g. `canary`, `1.34.3-canary.0`). Use `--sdk-version canary` where `--canary` was used before.
