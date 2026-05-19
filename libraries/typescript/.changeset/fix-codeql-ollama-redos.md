---
"@mcp-use/inspector": patch
---

Replace the trailing-slash regex in `normalizeOllamaBaseUrl` with an explicit linear scan. The regex was flagged by CodeQL as a polynomial regular expression on uncontrolled input; the new implementation is unambiguously linear and behaves identically. Adds unit tests for `normalizeOllamaBaseUrl` and `buildOllamaApiUrl`.
