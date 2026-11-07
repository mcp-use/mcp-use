---
name: manufact-analytics
description: Query deployed MCP server usage, errors, latency, clients, and actors through the Manufact Cloud CLI using a live catalog and read-only SQL. Use for server analytics questions, not PostHog CLI adoption tracking or analytics configuration.
---

# Query server analytics from the CLI

Use `mcp-use analytics catalog` and `mcp-use analytics query` with `--json`.
They use the CLI's existing Cloud login. Server selection is `--server`,
`MANUFACT_SERVER`, then the project link. Preserve the user's server,
organization, time window, and branch across calls. Use `servers list --json`
to find a missing server ID or slug; `--org` selects its organization.

Read the live catalog before writing SQL:

```bash
mcp-use analytics catalog --server my-server --json
```

The catalog supplies ClickHouse relations and columns, grains, metric SQL
expressions, units, approximation semantics, examples, retention, and query
budgets. Use that returned contract rather than inventing fields or relying
on a fixed schema. A catalog read does not itself establish usage totals.

Send one quoted SQL argument, using only catalog relations and columns.
Cloud accepts one read-only SELECT or UNION; SETTINGS, FORMAT, INTO, table
functions, and non-catalog tables are rejected. Authorization and retention
are enforced by Cloud. Do not work around a rejection with direct database
credentials.

```bash
mcp-use analytics query "SELECT client_name, sum(events) AS requests FROM clients_daily WHERE bucket >= {from:DateTime64(3)} AND bucket < {to:DateTime64(3)} AND traffic_class != 'non_mcp' GROUP BY client_name ORDER BY requests DESC LIMIT 20" --server my-server --time-range 7d --max-rows 20 --json
```

This example depends on the current catalog. Prefer its worked examples and
measure SQL when they answer the question. Include time predicates explicitly:
`--time-range` binds `{from:DateTime64(3)}` and `{to:DateTime64(3)}`; raw events
use `time`, while rollups use `bucket`. Keep the same range on every relation
in a join or union. SQL traffic selection is explicit: the example excludes
non-MCP HTTP through `traffic_class`, as described by the catalog.

The default window is `7d`; presets are `1h`, `24h`, `7d`, `30d`, and `90d`.
For calendar periods, resolve dates in the user's timezone, then use
`--from <ISO timestamp> --to <ISO timestamp>` with UTC offsets, without
`--time-range`. The start is inclusive and end exclusive. The end cannot be
in the future. For comparisons, use equal-duration, non-overlapping windows
with identical filters, and identify incomplete days.

Omitting `--branch` includes all environments; it does not select production.
An explicit branch selects that preview branch and must be one of the
catalog's `branches`; an unknown branch fails with
`ANALYTICS_BRANCH_NOT_FOUND` rather than returning zero. Use the catalog's subdomain
mapping when a production-only population or grouping needs SQL filtering.
Manufact internal traffic is excluded unless `--include-internal` is passed.
Pass the same branch to catalog and query when analyzing a preview.

SQL is limited to 16384 UTF-8 bytes. `--max-rows` defaults to 100 and allows
1–500 rows. Put output options before `--` when SQL starts with a dash, such
as a leading SQL comment. Check `mcp-use analytics query --help` for the
installed version's flags.

Read [SQL patterns and interpretation](references/queries.md) for rollup
aggregation, sketches, result interpretation, and query recovery.

Read results by pairing each row with `columns` in order. Preserve 64-bit
integer strings. Report truncation, retention limits, freshness, and
approximation when they affect the conclusion. An empty retained result
does not establish that the server has never received traffic.
