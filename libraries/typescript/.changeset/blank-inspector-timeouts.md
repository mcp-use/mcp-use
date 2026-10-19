---
"@mcp-use/inspector": patch
---

Fix tool calls timing out after 10 seconds for servers added from the dashboard. The Connect form pre-filled Request Timeout with 10000 and Maximum Total Timeout with 60000, and since tool calls started honoring saved timeouts those values capped every call. Both fields now start blank, which means the default 10-minute request timeout and no overall limit, as the form's help text says. Servers added since that change keep the saved 10000 / 60000 values; clear both fields in the server's connection settings to go back to the defaults.
