---
"@mcp-use/cli": minor
---

**Breaking:** every argument that selects an existing eval suite now takes a suite ID only, because suite names aren't unique: `evals get`, `export`, `update`, `rm`, `run` and `runs --suite`. Suite names, suite files and directories are no longer accepted there; an argument that isn't a suite ID fails with `eval_suite_not_found` and points to `mcp-use evals list`. `evals run --all` is unchanged, and suite files still supply suite content through `evals push` (which matches files by name), `create --file` and `update <suite-id> --file`.

**Breaking:** `checklist run` and `checklist get` `--markdown-file` now write the same report as the Manufact GitHub app's publishing check: it starts with `## Publishing checks`, then an outcome title (for example `Ready to submit` or `2 required fixes before submission`), a summary, and Required fixes, Policy concerns and Recommendations tables (up to 10 rows each; live tests excluded), and ends with a dashboard link. The collapsible "Prompt for AI agents" block now uses the fix prompt Manufact Cloud returns with the run, and is left out when Cloud returns none. Like the app's output, the report stays under 50,000 bytes: findings that don't fit are cut with "More findings in the checklist.", and a fix prompt that doesn't fit is shortened with a note.

`checklist run`, `get` and `cancel` add `fixPrompt` (`string | null`) to their `--json` and `--json-file` result: Cloud's copyable prompt for fixing the run's failed checks, or `null` when Cloud returns none.
