---
"mcp-use": major
---

Remove the imperative `modelContext.set()`, `modelContext.remove()`, and
`modelContext.clear()` React exports. Describe model-visible UI with the
declarative `<ModelContext>` component so annotations follow React state,
nesting, and component lifecycle.
