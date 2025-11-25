---
"create-mcp-use-app": patch
"@mcp-use/inspector": patch
"mcp-use": patch
---

- **Security**: Added `https://*.openai.com` to Content Security Policy trusted domains for widgets
- **Type safety**: Exported `WidgetMetadata` type from `mcp-use/react` for better widget development experience
- **Templates**: Updated widget templates to use `WidgetMetadata` type and fixed CSS import paths (moved styles to resources directory)
- **Documentation**: Added comprehensive Apps SDK metadata documentation including CSP configuration examples
