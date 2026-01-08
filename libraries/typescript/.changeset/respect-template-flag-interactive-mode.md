---
"create-mcp-use-app": patch
---

fix: respect --template flag in interactive mode. Previously, when no project name was provided as a positional argument, the CLI would always prompt for template selection even if --template was explicitly provided via the command line flag. The tool now correctly uses the --template value when provided, only prompting for template selection when the flag is not specified.

