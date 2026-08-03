---
"create-mcp-use-app": patch
---

Drop the stale `main` field from the scaffolded package.json and give each template its own description.

`main` still pointed at `dist/index.js`, which v2 never produces since builds now go to `.mcp-use/build`. The templates are applications started with `mcp-use start` rather than importable packages, so the field is removed instead of repointed at a gitignored build directory.

All three templates also shared the description "an mcp-use server", which made `--list-templates` useless for telling them apart and put the same string in every generated project.

Scaffolding also stopped discarding those descriptions. `updatePackageJson` overwrote `description` with a generic `"<name>: an mcp-use server"` on every run, so a generated project never kept the description of the template it came from. It now only fills that in when the template has no description of its own.
