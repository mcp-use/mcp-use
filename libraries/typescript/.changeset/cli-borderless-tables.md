---
"@mcp-use/cli": minor
---

feat(cli): borderless aligned-columns table rendering, gh/kubectl style

Replaced the box-drawing ASCII table in `mcp-use client {tools,resources,prompts,sessions} list` with a borderless layout: UPPERCASE bold headers, two-space gutter between columns, ANSI-stripped width math, ellipsis truncation for long descriptions, sized to the terminal width (or 100 cols). Tool rows now also show a `MODE` column (read-only / write / destructive, derived from the tool's MCP annotations) and an `ARGS` column (required/total).

When stdout is not a TTY (pipes, agents, CI), every list command instead emits tab-separated values with no header, no decorative banners, and no ANSI — matching how the GitHub CLI behaves. This makes the CLI directly parseable by AI agents and shell pipelines.
