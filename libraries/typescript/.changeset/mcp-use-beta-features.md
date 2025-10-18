---
'mcp-use': minor
---

feat: Add OpenAI Apps SDK integration

- Added new UI resource type for Apps SDK, allowing integration with OpenAI's platform
- Enhanced MCP-UI adapter to handle Apps SDK metadata and structured content
- Updated resource URI format to support `ui://widget/` scheme
- Enhanced tool definition with Apps SDK-specific metadata
- Ensure `_meta` field is at top level of resource object for Apps SDK compatibility
- Added comprehensive test suite for Apps SDK resource creation
- Updated type definitions to reflect new resource capabilities

refactor: Improve compatibility

- Renamed `fn` to `cb` in tool and prompt definitions for consistency.
- Updated resource definitions to use `readCallback` instead of `fn`.
- Adjusted related documentation and type definitions to reflect these changes.
- Enhanced clarity in the MCP server's API by standardizing callback naming conventions.

