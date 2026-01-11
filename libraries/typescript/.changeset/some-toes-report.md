---
"mcp-use": minor
"@mcp-use/cli": minor
---

feat: Hot Module Reloading (HMR) for MCP server development

Added HMR support to the `mcp-use dev` command. When you modify your server file (add/remove/update tools, prompts, or resources), changes are applied instantly without restarting the server or dropping client connections.

**Features:**
- Tools, prompts, and resources can be added, removed, or updated on-the-fly
- Connected clients (like the inspector) receive `list_changed` notifications and auto-refresh
- No changes required to user code - existing server files work as-is
- Syntax errors during reload are caught gracefully without crashing the server

**How it works:**
- CLI uses `chokidar` to watch `src/` directory and root `.ts`/`.tsx` files
- On file change, the module is re-imported with cache-busting
- `syncRegistrationsFrom()` diffs registrations and uses the SDK's native `RegisteredTool.update()` and `remove()` methods
- `list_changed` notifications are sent to all connected sessions

**Usage:**
```bash
mcp-use dev  # HMR enabled by default
mcp-use dev --no-hmr  # Disable HMR, use tsx watch instead
```
