---
"@mcp-use/cli": patch
---

fix(cli): don't auto-open a browser for OAuth in non-TTY contexts

When `mcp-use client connect` (or a session restore) hits an OAuth flow,
the CLI used to launch the user's browser unconditionally. That's the
right call from an interactive terminal, but surprising when an LLM
agent or a CI script runs the same command — the agent has no way to
"see" the browser, and the user gets an unexpected window.

`stdout.isTTY` now gates the browser launch:

- TTY: opens the browser as before.
- Non-TTY: prints the authorization URL to stderr and waits on the
  loopback callback, so the caller (human or agent) can hand the URL
  off however it wants.

The leading "→ Opening browser to authenticate..." message is also
adjusted to "→ OAuth authentication required." in non-TTY mode so the
log doesn't claim a browser was opened when it wasn't.
