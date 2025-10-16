---
'@mcp-use/inspector': patch
---

fix: CLI binary format and package configuration

- Changed CLI build format from CommonJS to ESM for ESM-only dependency compatibility
- Added prepublishOnly hook to ensure build before publishing  
- Updated documentation references from @mcp-use/inspect to @mcp-use/inspector
- Removed compiled artifacts from source directory
- Added input validation for port and URL arguments
- Improved error logging in API routes
- Fixed async/await bugs in static file serving
