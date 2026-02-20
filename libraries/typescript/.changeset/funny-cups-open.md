---
"@mcp-use/inspector": patch
"mcp-use": patch
---

feat(widget): introduce invoking and invoked status texts for improved user feedback

- Added `invoking` and `invoked` properties to widget metadata, allowing for customizable status messages during tool execution.
- Updated relevant components to display these status texts, enhancing user experience by providing real-time feedback on tool operations.
- Adjusted default values for `invoking` and `invoked` to improve clarity and consistency across widgets.
- Refactored documentation to reflect changes in widget metadata and usage patterns, ensuring developers have clear guidance on implementing these features.