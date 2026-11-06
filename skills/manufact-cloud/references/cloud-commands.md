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

For `github repos`, a single active installation is selected automatically.
If there are several, pass `--installation` with the provider `installationId`
from `github installations --json`.

`checklist run` waits by default. Both run and list accept `--branch`;
list also accepts `--limit` and `--skip`.

## Interpret checklist results

Without `--json`, run/get/cancel group results into Protocol, Tools, MCP Apps,
Client compatibility, Policy review, and any additional categories returned by
Cloud. Passing checks are summarized; findings, skipped checks, and remediation
hints remain visible. Add `--verbose` to run/get/cancel to include every passing
check and full finding details. List prints run status, branch, duration, age,
and full IDs when available.

The human report uses each check's severity: a raw `fail` can be an advisory
warning rather than a blocking error. JSON preserves the existing raw statuses;
use the human report to inspect severity and remediation rather than treating
every raw failure as a blocker. Dynamic policy concerns are called out separately
from technical warnings. The score weights check severity and is not a count of
all passed checks.

**Client Readiness** reports Cloud's ChatGPT and Claude readiness flags. A
completed command or a high score does not guarantee directory approval, and
reported readiness can coexist with policy concerns. Inspect the actual findings
before recommending a submission.
