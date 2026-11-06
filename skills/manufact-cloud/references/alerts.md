# Alert authoring

The CLI uses the same YAML format as the dashboard. Fetch current choices with
`mcp-use alerts options --json`, then create or update a rule from a file:

```bash
mcp-use alerts create --file alert.yaml --json
mcp-use alerts update ALERT_ID --file alert.yaml --json
mcp-use alerts list --json
mcp-use alerts get ALERT_ID --json
```

For human review, omit `--json`. `alerts get` describes the enabled or paused
setting, delivery methods, and trigger/recovery conditions, preserving nested
`all`/`any` groups. `alerts list` also shows current firing/resolved state and
trigger counts when returned by Cloud. The detail response does not return
state or occurrence history; do not invent them from the rule configuration.
An enabled rule is being evaluated; a firing rule currently matches its trigger.
Slack as a delivery method does not establish that a notification was delivered.

## Example: sustained tool failures

```yaml
name: High tool failure rate
description: Tool calls are failing more often than expected.
trigger:
  when:
    all:
      - metric: tool.calls
        op: gte
        value: 20
      - metric: tool.errorPercent
        op: gte
        value: 5
  for: 2m
recover:
  name: Tool calls are healthy again
  when:
    all:
      - metric: tool.calls
        op: gte
        value: 20
      - metric: tool.errorPercent
        op: lt
        value: 2.5
  for: 2m
notify:
  - type: email
    recipients:
      - team@example.com
```

Choose meaningful thresholds from the server's normal traffic, not from this
example alone. Pair percentage thresholds with a minimum count to avoid a
single failure triggering an alert. Use a lower recovery threshold than the
trigger threshold to avoid repeated open/resolve notifications near a boundary.

`enabled` is optional YAML: `false` pauses a rule. Creation defaults it to
`true`; updating without it preserves the rule's current enabled/paused state.
Updates and removals read the current revision first. A concurrent edit causes
a conflict instead of overwriting another user's change.

## Rule shape

- `name` is required, one line, up to 120 characters. Optional `description`
  is one line, up to 500 characters.
- `trigger.when` and `recover.when` are conditions. A condition is either
  `{ metric, op, value }`, `{ all: [...] }`, or `{ any: [...] }`.
- Operators are `gt`, `gte`, `lt`, `lte`, `eq`, and `ne`; values are numbers.
- Groups have 1–8 children and can nest up to three levels.
- Both `trigger.for` and `recover.for` are required whole-number durations
  from `0s` through `1h`, using `s`, `m`, or `h`. Rules evaluate every minute;
  `0s` means the first matching observation, not continuous evaluation.
- Recovery may supply its own `name` and `description`.
- `notify` accepts email and Slack, each type once. An email entry may list
  up to 20 `recipients`; omission uses the creator's current email while they
  remain a member. A Slack entry accepts `channel`, a connected workspace's
  channel ID; omission uses its connected default channel.

Missing or stale data cannot open an alert or prove recovery, and interrupts
holds. Reachability alerts use real server traffic; they do not generate probes
or wake stopped servers. Low measurements from only part of the fleet cannot
prove complete recovery.

## Choose the metric

- Tool failures: `tool.calls`, `tool.errors`, `tool.errorPercent`.
- MCP request failures: `request.requests`, `request.errors`, `request.errorPercent`.
- Reachability: `request.reachabilityRequests`, `request.unreachablePercent`.
- Capacity: `cpu.busyPercent`, `cpu.stealPercent`, `memory.usagePercent`.
- Deploy failures: `deployment.failedCount`; recover when it equals zero.
- Credential rejection: `authentication.requests`, `authentication.rejectionPercent`.
- Token requests: `token.requests`, `token.errorPercent`, `token.latencyP95Ms`.

Use `alerts options` as the source of available metrics for the installed CLI.
A deployment failure is resolved by a later successful deployment in its own
production/preview branch lane. A rule on `deployment.failedCount` recovers
only when all failures counted by that rule have cleared.

For first-observed failures after a specific start time, compare
`deployment.latestOpenFailureAtMs` against that start time in Unix milliseconds:
`gt` to trigger and `lte` to recover, using the same cutoff. Ask for the intended
start time or derive it from the user's explicit time window; do not reuse a
fixed historical timestamp from an example.

The [dashboard alert documentation](https://docs.manufact.com/dashboard/alerts)
contains the complete format and metric semantics.
