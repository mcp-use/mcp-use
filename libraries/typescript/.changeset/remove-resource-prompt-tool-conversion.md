---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Add `exposeResourcesAsTools` and `exposePromptsAsTools` options to `MCPAgentOptions` (both default to `true` for backward compatibility). The inspector chat tab now sets both to `false`, so the agent only exposes actual MCP tools to the LLM rather than fabricating tool wrappers for resources and prompts.
