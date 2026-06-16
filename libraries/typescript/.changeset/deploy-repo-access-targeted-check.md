---
"@mcp-use/cli": patch
---

Fix `mcp-use deploy` falsely reporting that the GitHub App cannot access a repository. The pre-flight repo-access check no longer lists/paginates an installation's repos (which only inspected the first page, so repos on later pages were missed, and fully paginating hung on very large orgs). It now asks the backend an authoritative per-installation question (a single GitHub `repos.get`), trying the installation whose account matches the repo owner first and falling back to the others. Requires the backend `GET /github/installations/:installationId/repos/:owner/:repo/access` endpoint.
