---
"create-mcp-use-app": patch
---

Strip leading underscores when sanitizing a project name into an npm package name. `create-mcp-use-app _foo` produced `"name": "_foo"`, which npm publish rejects with "name cannot start with an underscore".
