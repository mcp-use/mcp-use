# Other Cloud commands

Use `--json` on each command and inspect `--help` for exact argument positions.

| Area | Commands and purpose |
| --- | --- |
| Organization | `org list`, `current`, `use`, `create`, `update`; select by ID or slug |
| Team | `org members`; `org invites list`, `send`, `cancel` |
| GitHub | `github connect` prints an installation URL; `installations` and `repos` inspect access |
| Domains | `domains get`, `set-subdomain`, `add`, `verify`, `rm` |
| Publish checks | `checklist run`, `list`, `get`, `cancel` |

A domain addition returns the CNAME target. Configure that exact DNS record
with the domain's provider, then run `domains verify` and inspect its result.
A preview domain can target a branch when supported by `--branch`.

An invitation needs the recipient email and an appropriate organization role.
Use the returned invitation ID when canceling; do not confuse it with a member ID.

Publishing checks assess a server for app directories. Start with
`checklist run`, inspect findings, and address the concrete failing requirements.
Use `--no-wait` to retain the run ID and inspect it later through `checklist get`.
A successful checklist run is evidence about those checks; publication itself
remains a separate action.
