# MCP notifications

`publish-changes` increments `example://status` and emits tools-list,
resources-list, and resource-updated notifications. Connect with a client that
subscribes to notifications, then call the tool and re-read the resource.

```sh
pnpm dev
pnpm verify
```
