---
"@mcp-use/cli": patch
---

Keep interactive OAuth prompts outside the HTTP connection timeout. Waiting for Enter now respects the OAuth timeout, and the prompt closes when authorization completes, expires, or is cancelled.
