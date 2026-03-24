---
"@mcp-use/cli": minor
---

Add organization support to the CLI

- `mcp-use org list` / `switch` / `current` commands to manage organizations
- `mcp-use deploy --org <slug-or-id>` to deploy to a specific organization
- Login flow now prompts for organization selection when the user belongs to multiple orgs
- `whoami` displays the active organization
- All API requests include `x-profile-id` header for org-scoped operations
- Organization preference is persisted in `~/.mcp-use/config.json`
