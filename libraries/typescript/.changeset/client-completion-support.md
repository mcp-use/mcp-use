---
"mcp-use": minor
---

Add client-side completion support for prompt arguments and resource template URIs

This adds the ability for clients to request autocomplete suggestions from MCP servers:

- New `complete()` method in BaseConnector, MCPSession, and useMcp hook
- Support for both prompt argument completion and resource template URI completion
- Fix `resourceTemplates` state population in useMcp (was never populated)
- New `refreshResourceTemplates()` method in useMcp hook
- Comprehensive documentation in docs/typescript/client/completion.mdx
- Integration and unit tests for completion functionality

The completion feature allows servers to provide static lists or dynamic callbacks for suggesting values based on partial user input, improving the autocomplete experience in client applications.
