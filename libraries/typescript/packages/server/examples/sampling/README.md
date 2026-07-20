# Sampling boundary

The legacy server-initiated sampling callback is intentionally unsupported in mcp-use V2: it relied on a long-lived connection/session. This example provides a deterministic tool result that lets a host handle the model work itself and pass the result back through a normal tool call.

```bash
pnpm dev
```
