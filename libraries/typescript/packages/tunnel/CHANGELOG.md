# @mcp-use/tunnel

## 0.2.0

### Minor Changes

- 668a312: Publish the authenticated WebSocket tunnel client as a standalone package and
  bundle the same implementation into `mcp-use dev/start --tunnel`. This removes
  native tunnel binaries and adds bounded HTTP, streaming, MCP JSON-RPC, and
  public WebSocket forwarding without adding a runtime dependency to `mcp-use`.

### Patch Changes

- 42fe287: Allow production `start --tunnel` traffic through localhost Host validation while preserving the public forwarded origin.

## 0.2.0-canary.1

### Patch Changes

- 42fe287: Allow production `start --tunnel` traffic through localhost Host validation while preserving the public forwarded origin.

## 0.2.0-canary.0

### Minor Changes

- 668a312: Publish the authenticated WebSocket tunnel client as a standalone package and
  bundle the same implementation into `mcp-use dev/start --tunnel`. This removes
  native tunnel binaries and adds bounded HTTP, streaming, MCP JSON-RPC, and
  public WebSocket forwarding without adding a runtime dependency to `mcp-use`.
