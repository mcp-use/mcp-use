---
"create-mcp-use-app": patch
"@mcp-use/inspector": patch
"mcp-use": patch
"@mcp-use/cli": patch
---


Fix HMR file watcher exhausting inotify limits by properly ignoring node_modules

The HMR file watcher was attempting to watch files inside `node_modules/` despite having ignore patterns configured, which exhausted the inotify watch limit (ENOSPC errors) in containerized environments.
