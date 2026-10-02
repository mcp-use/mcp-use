---
"@mcp-use/cli": patch
---

`mcp-use deploy` now verifies that a Git remote is actually hosted on `github.com` before treating it as a GitHub repository. Non-GitHub hosts that contain `github.com` in their hostname or path are rejected instead of being mapped to an unrelated GitHub repository. Only explicit HTTP(S), SSH, Git, or SCP-style GitHub remotes with the original owner/repo path shape are accepted.
