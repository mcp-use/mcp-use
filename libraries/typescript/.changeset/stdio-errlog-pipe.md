---
"mcp-use": patch
---

Fix `errlog` being a silent no-op on stdio connections: `StdioConnectionManager` now spawns the child with `stderr: "pipe"` (unless an explicit stderr mode is set in server params), so the child's stderr is actually forwarded to the configured `errlog` stream instead of always inheriting the parent's stderr. Fixes #1899.

Pass any `Writable` to capture a server's stderr:

```ts
import { StdioConnector } from "mcp-use";
const connector = new StdioConnector({
  command: "npx",
  args: ["my-mcp-server"],
  errlog: myWriteStream, // defaults to process.stderr (previous behavior)
});
```

Setting an explicit `stderr` mode in server params still takes precedence.
