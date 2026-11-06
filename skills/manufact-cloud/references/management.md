# Server and environment management

```bash
mcp-use servers list --json
mcp-use servers get --server weather --json
mcp-use link --server weather --org my-team --json
mcp-use env list --json
```

Use `--server` and `--org` to override the linked project. Cloud commands do not
need to run inside an mcp-use application.

Without `--json`, server details show status, organization, production branch,
repository, region, MCP URL, active deployment, and dashboard link when
available. Environment lists show names and metadata in a table, never values.
Domain output includes verification/certificate readiness and copyable CNAME or
TXT records when supplied by Cloud; use those exact records rather than guessing
DNS targets. Create/update/remove commands print named confirmation receipts.

`servers update` changes user-visible settings: name, description, production
branch, repository root, build/start commands, watch paths, deployment branch
patterns, CI waiting, repository connection, and allowed IP ranges.
Use `--disconnect-repo` to detach the repository. `--wait-for-ci` and
`--no-wait-for-ci` explicitly set a saved setting in either direction.

Environment variables are scoped by `--environment production|preview|development`
and optionally `--branch`. Use `--phase runtime|build|both` when assigning one.
Listing shows keys and metadata; stored values are write-only.

```bash
mcp-use env set LOG_LEVEL=info --environment production --json
mcp-use env push .env.production --environment production --json
mcp-use env rm OLD_KEY --environment production --yes --json
```

For secrets, use `env set` with `--sensitive` and pipe the value through stdin
as described by `mcp-use env set --help`. Never substitute a secret into an
example, a returned command, or a diagnostic message.

Choose scope deliberately: an unscoped preview value applies across preview
branches, while a branch override applies only to that branch. Removing a
branch override can reveal an inherited value.
