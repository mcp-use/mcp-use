---
"@mcp-use/cli": minor
---

**Breaking:** eval suite files have a new format. `task` (what the model is asked) replaces `flow`, `judge` replaces `rubric`, and `required-tools` lists tools the model must call at least once, anywhere in the run. `clients` has one key per client (`manufact-inspector`, `claude-code`, `codex`, `pi`, `chatgpt-web`, `claude-web`), each with `model` or `models` (`model: default` runs a web app's default model) and `tool-search` for `claude-code`. `disallowedTools` is removed. Every key the format defines is kebab-case. A file's `id` may also be the suite's UUID.

The CLI owns the format and writes suites through Cloud's JSON API (`task`, `judge`, `requiredTools`, `clients`). `evals push` checks every file before writing any, so an invalid file, an unknown UUID or two files naming the same suite lists each file's error and writes nothing; it then creates or updates one suite per file, and a suite Cloud rejects is reported while the others are written. A file without `clients` keeps an existing suite's clients, and a push keeps the experimental clients (Cursor, the native apps) that files can't name. `evals push --dry-run` runs the checks and prints what would be created or updated. `evals export` and `evals get` render the file locally. `evals list --json` and `get --json` return `task`, `judge`, `requiredTools` and `clients`.
