---
"mcp-use": patch
---

fix(ui-resource-registration): improve metadata handling for server origin injection

- Simplified the logic for enriching UI resource definitions with server origin by ensuring metadata is created if it doesn't exist.
- Enhanced the handling of Content Security Policy (CSP) to always include server origin in resourceDomains, connectDomains, and baseUriDomains, improving security and functionality for widget loading.