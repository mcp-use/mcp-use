---
"@mcp-use/cli": patch
---

fix(cli): propagate `--env`/`--env-file` to the server on `mcp-use deploy` redeploys

`mcp-use deploy --env KEY=VAL` previously only forwarded env vars when the
deploy created a new server: the values rode along on the `createServer`
request body. On redeploys (an existing linked server, or a previously failed
deployment), the CLI parsed the flags, displayed them in the configuration
preview, and then silently dropped them — `createDeployment` was called
without ever touching the server's env vars.

The deploy command now upserts each `--env`/`--env-file` entry against the
server's env-variables API before triggering the deployment: keys that exist
get a `PATCH` with the new value, new keys get a `POST`. Keys not present in
the supplied set are left untouched (clearing still requires
`mcp-use servers env rm`).
