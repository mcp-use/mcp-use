---
"mcp-use": patch
"@mcp-use/agent": patch
"@mcp-use/inspector": patch
---

Harden the v2 beta release train and package boundaries before GA.

- Reject prerelease plans that would reuse or lag an npm beta version, and keep Inspector versioned with the exact `mcp-use` beta it supports.
- Use the modern Langfuse LangChain adapter so the Agent's optional LangChain and observability peers resolve together.
- Keep Inspector framework peers optional for standalone installs and refresh public v2 server and MCP Apps documentation.
