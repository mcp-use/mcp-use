---
"@mcp-use/cli": patch
---

`mcp-use deploy --org <org>`: respect the flag when a project is already linked to a server in a different organization. Previously, the existing `.mcp-use/project.json` link was followed unconditionally, silently ignoring `--org` and redeploying to the linked (wrong-org) server. Now the CLI verifies the linked server's organization matches the requested one and, if not, warns and creates a new server in the specified org.
