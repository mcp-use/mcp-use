---
"@mcp-use/agent": minor
---

Default `autoInitialize` to on in simplified mode so `run()` works without a manual `initialize()` call. Drop the `@mcp-use/agent/browser` entry — use `@mcp-use/agent` in Node and the browser. Remove `chalk` and `cli-highlight` (pretty terminal output uses a small inline ANSI helper). Re-export `MCPAgent` from `@mcp-use/agent/langchain`, add package examples, and clarify install docs (`@mcp-use/client` is a dependency; `/langchain` is a subpath).
