---
"@mcp-use/client": patch
---

Fix code mode ignoring `codeMode.executorOptions.timeoutMs` for code runs. When the model omitted the optional `timeout` argument of the `execute_code` tool, the connector passed a hardcoded 30000 to the executor, so a configured timeout never applied: a shorter limit did not stop runaway code sooner, and a longer one still cut runs off at 30 seconds. The connector now leaves the timeout unset in that case, and both executors use their configured `timeoutMs`. The E2B executor previously used `timeoutMs` only for the sandbox lifetime and always ran code with a 30000 command timeout; it now applies a configured `timeoutMs` to each run. With nothing configured, runs still default to 30000. An explicit positive `timeout` still takes precedence, and the tool schema no longer advertises a fixed 30000 default.
