---
"@mcp-use/client": patch
---

Reuse the loopback callback port stored in the last OAuth registration when a later Node provider is created, so a provider used only to connect keeps the registration and tokens from the last sign-in instead of dropping them when it probed a different port.
