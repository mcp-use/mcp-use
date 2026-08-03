---
"mcp-use": minor
---

Add a temporary v1 drop-in compatibility entry for migrating existing servers to v2 without rewriting server code.

**mcp-use**

- Add deprecated `mcp-use/server` export backed by the native stateless v2 server, preserving common v1 tool, resource, template, prompt, OAuth, OpenAPI, and response-helper shapes.
- Teach `mcp-use dev`, `build`, and `start` to detect the compatibility server, load legacy widget metadata, and prime views through the v2 manifest pipeline.
- Add deprecated React compatibility exports under `mcp-use/react` for legacy widget hooks and components.
- Document the migration bridge in `v2-MIGRATION.md` and `v2-DROP-IN-PLAN.md`.

The compatibility entry is intentionally isolated from the native root bundle so v2 import paths keep their existing size budgets. It will be removed in mcp-use v3.
