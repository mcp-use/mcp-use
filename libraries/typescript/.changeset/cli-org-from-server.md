---
"@mcp-use/cli": patch
---

Project-scoped Cloud commands such as `evals run` now act in the organization that owns `--server` (or `MANUFACT_SERVER`) when no `--org`, `MANUFACT_ORG`, link or active organization chooses one, instead of failing with "No active organization." for users in several organizations without a dashboard default.
