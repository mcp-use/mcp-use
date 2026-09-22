---
"@mcp-use/cli": patch
---

Resolve the organization in `mcp-use whoami` the same way `org current` and every `servers`/`deployments` command already do, by falling back to the account default when the local config has no explicit selection. Authenticating with `MCP_USE_API_KEY` without running `mcp-use login` previously made `whoami` report `organization: null` while the rest of the CLI read and mutated that organization's resources.
