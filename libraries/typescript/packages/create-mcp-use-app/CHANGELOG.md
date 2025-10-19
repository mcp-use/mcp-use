# create-mcp-use-app

## 0.4.0

### Minor Changes

- 0f2b7f6: feat: Add Apps SDK template for OpenAI platform integration
  - Added new Apps SDK template for creating OpenAI Apps SDK-compatible MCP servers
  - Included example server implementation with Kanban board widget
  - Pre-configured Apps SDK metadata (widgetDescription, widgetPrefersBorder, widgetAccessible, widgetCSP)
  - Example widgets demonstrating structured data handling and UI rendering
  - Comprehensive README with setup instructions and best practices
  - Support for CSP (Content Security Policy) configuration with connect_domains and resource_domains
  - Tool invocation state management examples

## 0.3.5

### Patch Changes

- fix: update to monorepo

## 0.3.4

### Patch Changes

- 55dfebf: Add MCP-UI Resource Integration

  Add uiResource() method to McpServer for unified widget registration with MCP-UI compatibility.
  - Support three resource types: externalUrl (iframe), rawHtml (direct), remoteDom (scripted)
  - Automatic tool and resource generation with ui\_ prefix and ui://widget/ URIs
  - Props-to-parameters conversion with type safety
  - New uiresource template with examples
  - Inspector integration for UI resource rendering
  - Add @mcp-ui/server dependency
  - Complete test coverage

## 0.3.3

### Patch Changes

- fix: export server from mcp-use/server due to edge runtime

## 0.3.2

### Patch Changes

- 1310533: add MCP server feature to mcp-use + add mcp-use inspector + add mcp-use cli build and deployment tool + add create-mcp-use-app for scaffolding mcp-use apps

## 0.3.1

### Patch Changes

- 04b9f14: Update versions

## 0.3.0

### Minor Changes

- Update dependecies versions

## 0.2.1

### Patch Changes

- db54528: Migrated build system from tsc to tsup for faster builds (10-100x improvement) with dual CJS/ESM output support. This is an internal change that improves build performance without affecting the public API.
