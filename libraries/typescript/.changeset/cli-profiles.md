---
"@mcp-use/cli": minor
---

Add `mcp-use profiles list`, `profiles get <profileId>` and `profiles create` for organization profiles, the saved MCP sign-ins that `checklist run --profile` and `evals run --profile` use. `profiles create` opens a Cloud page where you sign in with OAuth in your browser, waits for it to finish, and prints the new profile ID. It signs in at the linked server's production MCP URL, or at any `https` URL given with `--url`. Pass `--no-wait` to print the sign-in URL and session ID instead of waiting. Secret values are never printed.
