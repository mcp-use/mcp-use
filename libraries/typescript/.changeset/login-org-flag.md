---
"@mcp-use/cli": minor
---

`mcp-use login`: add `--org <slug|id|name>` flag for non-interactive org selection. Previously, when a user had multiple organizations, login would prompt on stdin after the browser auth completed — leaving agent harnesses blocked because they cannot write to the running process's stdin. With `--org`, login picks the org up-front and skips the prompt. If login is run without a TTY and no `--org` is supplied, it now fails fast with a message pointing at the flag rather than hanging. Matches the resolver already used by `mcp-use deploy --org`.
