---
"mcp-use": patch
---

Keep generated OpenAPI tool names unique across operations so colliding names no longer overwrite each other. Declared operationIds keep their own names whatever the path order, and generated numeric suffixes only fill names that are still free.
