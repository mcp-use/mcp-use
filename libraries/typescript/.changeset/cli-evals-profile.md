---
"@mcp-use/cli": minor
---

feat(cli): add `--profile <id>` to `mcp-use evals run` to sign in with a chosen profile instead of the server's own. If Manufact Cloud doesn't apply the profile, the run is cancelled and the command fails rather than reporting results for the wrong account.
