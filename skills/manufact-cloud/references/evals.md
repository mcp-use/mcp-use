# Eval suites

An eval suite replays a conversation against a deployed server in one or more
clients, checks the expected tool calls, and has a judge score the result
against a rubric. Keep suites as YAML files in the repository and push them:

```bash
mcp-use evals push evals/ --json
mcp-use evals run --all --wait --json
mcp-use evals report RUN_ID --json
```

Commands that take a suite accept its ID, its name, or its suite file:
`mcp-use evals run evals/rome.yaml --wait`, `mcp-use evals get "Rome weather"`.
`evals run evals/` runs every suite defined in that directory.

`push` matches suites by name: it replaces a suite with the file's name or
creates one. A file is the suite's whole definition, so writing it resets every
omitted field to its default. `push` never deletes suites; use
`mcp-use evals rm "Suite name" --yes` when a file is removed. To start from a
suite built in the dashboard, run
`mcp-use evals export "Suite name" --out evals/name.yaml`.

## File format

```yaml
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

- `name` and `flow` are required, and `flow` needs at least one `user` step.
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
(Ctrl+C, a cancelled CI job) cancels the unfinished runs it started. Starting a run is not idempotent, so do not
retry a start whose outcome is unknown. Check `mcp-use evals runs --json`
first. `--branch NAME` targets a branch environment instead of production.
`--profile ID` signs in with that profile instead of the server's own (not for
native apps or plugin-lifecycle clients); a Cloud that ignores it gets the run
cancelled and the command fails.
If a start fails after others began, the error names the runs already going.
In CI, `--json-file PATH` and `--markdown-file PATH` (with `--wait`) write the
results and a Markdown report to files; on timeout both get the runs as they
stand.
