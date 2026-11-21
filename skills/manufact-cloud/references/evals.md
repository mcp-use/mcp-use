# Eval suites

An eval suite replays a conversation against a deployed server in one or more
clients, checks the expected tool calls, and has a judge score the result
against a rubric. Keep suites as YAML files in the repository and push them:

```bash
mcp-use evals push evals/ --json
mcp-use evals run --all --wait --json
mcp-use evals report RUN_ID --json
```

Every suite has a UUID and a slug (its ID within the server, such as
`rome-weather`). A suite ID is either one. Commands that select an existing
suite take a suite ID, never a name, because names aren't unique: `get`,
`export`, `update`, `rm`, `run` and `runs --suite` (`mcp-use evals list --json`
shows `id`, the UUID, and `slug`). For example
`mcp-use evals run rome-weather --wait` or `mcp-use evals get SUITE_ID`. A name
or a file path fails with `eval_suite_not_found`. `evals run --all` runs every
enabled suite.

`push` matches files to suites by the file's `id` (the slug): it updates the
suite with that slug or creates one with it, and prints `Created` or `Updated`
per file. Renaming a suite in its file keeps the same suite. Two files with the
same `id` fail the push (`eval_suite_duplicate_id`) before anything is written.
A file is the suite's whole definition, so writing it resets every omitted
field to its default. `push` never deletes suites; use
`mcp-use evals rm SUITE_ID --yes` when a file is removed. To start from a
suite built in the dashboard, run `mcp-use evals export SUITE_ID --out evals/`,
which writes `evals/<slug>.yaml`.

## File format

```yaml
id: rome-weather
name: Rome weather
flow:
  - kind: user
    content: What's the weather in Rome?
  - kind: tool_call
    name: get_weather
    args: { city: { contains: rome } }
  - kind: assistant_text
    note: States the temperature. Not scored.
rubric: Gives the current temperature in Rome.
threshold: 0.7
clients:
  inspector: { models: [openai/gpt-5] }
  runtimes: [{ harness: claude-code, model: anthropic/claude-sonnet-5.5 }]
  claude: true
disallowedTools: [delete_city]
enabled: true
```

- `id`, `name` and `flow` are required. `id` is the suite's slug: lowercase
  letters and digits in groups joined by single hyphens, at most 64
  characters, unique per server. It is never derived from `name`; a file
  without one fails, and the error suggests one. `name` is only the display
  name.
- `flow` needs at least one `user` step.
  Steps use the dashboard's shape: `kind: user` with `content`,
  `kind: tool_call` with `name` and optional `args` (a call the model must
  make before the next user turn), and `kind: assistant_text` with an optional
  `note` on the expected reply (not scored).
- Tool arguments match as follows: a string matches case-insensitively, and
  `"any"` accepts any value. `{ contains }`, `{ pattern }` (a case-insensitive
  regex), and `{ any: true, requirePresent: true }` are supported. Other values
  must match exactly.
- `clients` defaults to Inspector with the default model. Each key is one
  kind of client, and each model or entry runs as its own execution:
  - `inspector.models`: OpenRouter IDs for Manufact's hosted chat
    (`mcp-use evals models --json` lists them);
  - `runtimes`: `{ harness, model, provider? }` coding agents in a sandbox
    (`mcp-use evals options --harness claude-code --json` lists harnesses and
    models; add `--query` to search);
  - `chatgpt` / `claude`: `true` runs the web app's default model, and
    `{ models: [...] }` runs chosen ones. `evals options` says whether this
    organization can run them and lists their model IDs.
- `disallowedTools` applies to Inspector and runtimes only.
- Unknown fields are rejected, so a typo fails instead of being ignored.

## Running

`run` starts runs on Cloud and returns their IDs. With `--wait`, it exits 1
unless every run passes. On timeout (`eval_wait_timeout`) the runs keep going;
read them later with `report`. Stopping `run --wait` with SIGINT or SIGTERM
(Ctrl+C, a cancelled CI job) cancels the unfinished runs it started. Starting a run is not idempotent. `run`
looks for a run a lost start created before retrying it, but only as best
effort (it retries when Cloud can't be read in time), so before starting a
suite again yourself, check `mcp-use evals runs --json`. `--branch NAME` targets a branch environment instead of production.
`--profile ID` signs in with that profile instead of the server's own (not for
native apps or plugin-lifecycle clients); a Cloud that ignores it gets the run
cancelled and the command fails.
A suite that can't start doesn't stop the others: `run` retries dropped
connections, timeouts, 5xx and 429 up to 3 attempts, skips a suite Cloud
rejects, and stops starting on 401/403 (signed out, no access, credits or plan).
Suites without a run are listed in `notStarted` in the JSON, `--json-file`
and the Markdown report (also when none started), and the command exits 1
after reporting the runs that did start.
In CI, `--json-file PATH` and `--markdown-file PATH` (with `--wait`) write the
results and a Markdown report to files; on timeout both get the runs as they
stand.
