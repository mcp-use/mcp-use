---
"@mcp-use/cli": minor
---

**Breaking:** `evals run` now selects suites by ID only, because suite names aren't unique. Suite names, suite files and directories are no longer accepted; an argument that isn't a suite ID fails with `eval_suite_not_found` and points to `mcp-use evals list`. `--all` is unchanged, and `evals push` still matches suite files by name. `evals get`, `export`, `update`, `rm` and `runs --suite` still accept a name or a suite file.

**Breaking:** `checklist run` and `checklist get` `--markdown-file` now write the same report as the Manufact GitHub app's publishing check: it starts with `## Publishing checks`, then an outcome title (for example `Ready to submit` or `2 required fixes before submission`), a summary, and Required fixes, Policy concerns and Recommendations tables (up to 10 rows each; live tests excluded), and ends with a dashboard link. The collapsible "Prompt for AI agents" block now uses the fix prompt Manufact Cloud returns with the run, and is left out when Cloud returns none.
