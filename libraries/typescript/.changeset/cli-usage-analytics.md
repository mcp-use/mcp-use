---
"@mcp-use/cli": patch
"mcp-use": patch
---

Track anonymous CLI adoption and command usage in PostHog with a persistent random installation ID, allowlisted command names, version/platform metadata, and CI filtering. Honor MCP_USE_ANONYMIZED_TELEMETRY=false and DO_NOT_TRACK=1, omit argument values, and keep capture failures silent and bounded.
