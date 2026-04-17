---
"mcp-use": major
---

**Breaking:** `useWidget` generics are now **`useWidget<TToolInput, TState>()`** — the first type parameter types **`toolInput`** / **`partialToolInput`**, not widget props. Structured widget data should be typed on **component props** (inline JSX); `props` / `output` / `metadata` on the hook result are **`UnknownObject`**. Migrate `useWidget<Props>()` → `useWidget()` + props on the component, or `useWidgetProps<Props>()` / explicit casts.
