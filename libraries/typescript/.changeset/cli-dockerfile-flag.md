---
"@mcp-use/cli": patch
---

Add `--dockerfile` flag to `mcp-use deploy` for selecting a non-default Dockerfile path (relative to `--root-dir` or the repo root). Root `Dockerfile` is still auto-detected without the flag.
