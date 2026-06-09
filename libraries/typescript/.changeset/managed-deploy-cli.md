---
"@mcp-use/cli": minor
---

Add `mcp-use deploy --managed` to deploy a local MCP server without connecting your own GitHub. The project source is packed into a tarball and uploaded; the server is created in the platform-managed org and deployed through the normal pipeline. Redeploys of a managed project are auto-detected from the linked server, so `--managed` is only needed on the first deploy.

Also add `mcp-use login --device-code <code>` for non-interactive authentication with a pre-approved OAuth device code (used by the web onboarding flow), skipping the browser step.
