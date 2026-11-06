---
"@mcp-use/cli": patch
---

Add a generated, typed Manufact Cloud client and move `mcp-use deployments get` onto it. With `--json`, `deployments get` now prints errors on stdout as `{ "error": { code, message, nextSteps } }` instead of on stderr, and a network failure exits 1 with `cloud_unreachable` instead of exiting 2. Its successful output is unchanged.
