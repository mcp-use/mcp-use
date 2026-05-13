---
"@mcp-use/cli": patch
---

fix(cli): stop auto-opening the browser during OAuth flows

When an `mcp-use client` command needed to authenticate against an OAuth
server it would launch the user's browser via the `open` package on TTYs,
and only print the URL when stdout wasn't a TTY. That was surprising in two
directions: scripts that did happen to inherit a TTY got pop-up windows, and
the heuristic missed plenty of agentic/CI environments that *do* keep a TTY
attached. The CLI now always prints the authorization URL and waits on the
loopback callback — the user opens the link themselves whenever it's
convenient. (Other CLI surfaces that intentionally open a browser, like
`mcp-use deploy --open` and the auth login flow, are unchanged.)
