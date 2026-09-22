---
"mcp-use": patch
---

Separate View UI origins from MCP endpoint identity. Normalize HTTP(S) `view.domain` values to origins for ChatGPT and derive Claude resource domains from the full public MCP endpoint, including its path, using existing `MCP_URL` or request URL configuration. Preserve computed Claude domains and host defaults. Document migration, metadata precedence, proxy limitations, and nested-frame CSP in the SDK guide and repository agent skills.
