---
"@mcp-use/inspector": patch
---

fix(inspector): stop prompting signed-in users to log in on the hosted free tier

The hosted inspector (`inspector.manufact.com`) showed the "You're using
Manufact's free tier — Sign in to increase your limits" CTA to every visitor
using the managed LLM, even when they were already authenticated (MCP-2142).

`ChatTab` now resolves the shared Manufact session (via the new
`useHostedSession` hook, also used by `HostedUserMenu`) and only renders the
free-tier sign-in/upgrade chrome for anonymous visitors. The visibility rule is
extracted into a pure `shouldShowFreeTierUpgrade` helper and unit-tested.
