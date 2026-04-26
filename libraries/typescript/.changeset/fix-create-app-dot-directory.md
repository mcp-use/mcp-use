---
"create-mcp-use-app": patch
---

fix(cli): allow `.` as project name to initialize in current directory

When running `npx create-mcp-use-app .` in an empty directory, the CLI now
correctly initializes the project in the current directory instead of erroring
with "Directory already exists". Uses the directory name for `package.json` name
and display output. Errors if the directory is not empty.
