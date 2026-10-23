---
"@mcp-use/client": patch
---

Fix code mode's `execute_code` tool ignoring `codeMode.executorOptions.timeoutMs`. When the model omitted the optional `timeout` argument, the connector passed a hardcoded 30000 to the executor, so a configured timeout never applied: a shorter limit did not stop runaway code sooner, and a longer one still cut runs off at 30 seconds. The connector now leaves the timeout unset in that case, so the executor uses its configured value (30000 when nothing is configured). An explicit positive `timeout` still takes precedence. The tool schema no longer advertises a fixed 30000 default.
