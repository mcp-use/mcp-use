---
"@mcp-use/cli": minor
---

feat(cli)!: make widget screenshot opt-in on `mcp-use client <name> tools call`. The `--no-screenshot` flag is replaced by `--screenshot`. By default, tool calls no longer capture a PNG of any rendered widget; when a tool declares a UI resource and `--screenshot` is omitted, the CLI prints a hint suggesting the flag. Passing `--screenshot-output` or `--screenshot-device-scale-factor` implies `--screenshot`. Breaking: scripts/agents relying on auto-capture must add `--screenshot`.
