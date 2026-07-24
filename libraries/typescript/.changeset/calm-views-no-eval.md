---
"mcp-use": patch
"@mcp-use/cli": patch
---

Keep managed views on one deduplicated React runtime and configure Zod's supported jitless mode before view dependencies evaluate. This prevents invalid hook calls in development and removes the caught `eval` CSP violation without weakening the view sandbox policy.
