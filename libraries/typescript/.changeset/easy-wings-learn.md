---
'create-mcp-use-app': patch
'@mcp-use/inspector': patch
'mcp-use': patch
'@mcp-use/cli': patch
---

## Apps SDK widgets & Automatic Widget Registration

### Key Features Added

#### Automatic UI Widget Registration
- **Major Enhancement**: React components in `resources/` folder now auto-register as MCP tools and resources
- No boilerplate needed, just export `widgetMetadata` with Zod schema
- Automatically creates both MCP tool and `ui://widget/{name}` resource endpoints
- Integration with existing manual registration patterns

#### Template System Restructuring
- Renamed `ui-resource` → `mcp-ui` for clarity
- Consolidated `apps-sdk-demo` into streamlined `apps-sdk` template
- Enhanced `starter` template as default with both MCP-UI and Apps SDK examples
- Added comprehensive weather examples to all templates

#### 📚 Documentation Enhancements
- Complete rewrite of template documentation with feature comparison matrices
- New "Automatic Widget Registration" section in ui-widgets.mdx
- Updated quick start guides for all package managers (npm, pnpm, yarn)
- Added practical weather widget implementation examples


