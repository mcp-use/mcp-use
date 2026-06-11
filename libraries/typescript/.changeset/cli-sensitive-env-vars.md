---
"@mcp-use/cli": patch
---

Support write-only (sensitive) environment variables. The cloud API now withholds the value of `sensitive` env vars on read (returns `null`), so `EnvVariable.value` is nullable and `env list` / `env add` / `env update` print `<sensitive>` for withheld values instead of an empty string.
