---
"@mcp-use/client": minor
---

Add a boxd executor to code mode. `codeMode: { enabled: true, executor: "boxd" }` runs the code in a [boxd](https://boxd.sh?ref=mcp-use) microVM, with MCP tool calls run on the host like the E2B executor. It needs the optional peer dependency `@boxd-sh/sdk` and an API key (`executorOptions.apiKey` or `BOXD_API_KEY`). The executor creates one isolated machine on first use, reuses it for every call, and deletes it in `client.close()`. Options: `org`, `region`, `name`, `labels`, and `timeoutMs` to delete the machine after a set time even if `close()` never runs.
