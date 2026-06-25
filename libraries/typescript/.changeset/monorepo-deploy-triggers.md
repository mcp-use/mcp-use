---
"@mcp-use/cli": minor
---

Expose monorepo auto-deploy trigger config in the CLI. `mcp-use deploy` gains `--watch-paths` and `--wait-for-ci` for new GitHub servers, and `mcp-use servers update` gains `--watch-paths`, `--deploy-branches`, `--wait-for-ci`/`--no-wait-for-ci`, and `--root-dir`. `mcp-use servers get`/`update` now print the effective watch paths, deploy branch patterns, and wait-for-CI setting. This closes the gap where the Cloud API accepted these fields but the CLI could not set them, so monorepo apps can be scoped to only redeploy on relevant changes.
