---
"create-mcp-use-app": patch
---

Remove `--no-git` from the help output. Scaffolding stopped initializing a git repository in #820, and nothing has read the flag since, so the line described behaviour the tool no longer had.
