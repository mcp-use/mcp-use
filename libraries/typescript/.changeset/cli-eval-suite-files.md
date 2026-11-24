---
"@mcp-use/cli": minor
---

**Breaking:** eval suite files have a new format, and Manufact Cloud validates them instead of the CLI. `task` (what the model is asked) replaces `flow`, `judge` replaces `rubric`, and `required-tools` lists tools the model must call at least once, anywhere in the run. `clients` has one key per client (`manufact-inspector`, `claude-code`, `codex`, `pi`, `chatgpt-web`, `claude-web`), each with `model` or `models` (`model: default` runs a web app's default model) and `tool-search` for `claude-code`. `disallowedTools` is removed. Every key the format defines is kebab-case. A file's `id` may also be the suite's UUID.

`evals push` sends every file to Cloud in one request: Cloud validates all of them before writing any, so an invalid file (or two files naming the same suite) lists each file's error and writes nothing. `evals push --dry-run` validates and prints what would be created or updated. `evals export` and `evals get` print the file Cloud renders. `evals list --json` and `get --json` return `task`, `judge`, `requiredTools` and `clients`. Against a Cloud without suite files, `push` fails with `eval_suite_files_unsupported`.
