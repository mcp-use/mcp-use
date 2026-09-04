---
"@mcp-use/agent": patch
---

Fix `maxSteps` passed to `run`, `stream` or `streamEvents` not limiting model calls. The budget is baked into `modelCallLimitMiddleware` when the executor is built, so a per-call value never reached it: `run` and `stream` dropped it entirely, and `streamEvents` wrote it to the instance without rebuilding anything. It now goes through the run context, which the middleware reads first, and the constructor value stays the default for later calls.
