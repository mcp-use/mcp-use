---
"@mcp-use/agent": patch
---

Make `@mcp-use/agent` ESM-only for v2. The root, browser, and LangChain entry points no longer publish CommonJS builds or advertise `require()` conditions; use ESM `import` or dynamic `import()` from a CommonJS host.
