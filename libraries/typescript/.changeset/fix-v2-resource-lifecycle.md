---
"mcp-use": patch
"@mcp-use/cli": patch
---

Release active legacy streams during shutdown, prevent late async server setup from registering new exchanges after close, and invalidate custom event-bus callbacks even when backend unsubscription fails. Apply the safeguards at the framework boundary so both Node and portable package entries receive them.

Clean up initialized development resources when listener startup fails, keep production signal handlers active until cleanup finishes, and fail shutdown after a bounded deadline instead of waiting indefinitely.
