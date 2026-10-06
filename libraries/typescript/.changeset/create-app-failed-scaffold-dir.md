---
"create-mcp-use-app": patch
---

A scaffold that fails before copying the template no longer leaves an empty project directory behind. An unknown or invalid `--template`, or a GitHub template that can't be cloned, used to leave `my-project/` in place, so retrying with a valid template failed with `Directory "my-project" already exists!` until the directory was deleted by hand.
