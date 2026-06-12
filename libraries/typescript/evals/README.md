# @mcp-use/sdk-evals

Agentic-readiness evals for the mcp-use TypeScript SDK ([MCP-2072](https://linear.app/manufact/issue/MCP-2072)): how well can coding agents build MCP servers with our SDK, and what should we fix (docs / skill / SDK / templates) when they can't?

Evals run against the **published npm package** — what agents in the wild actually get.

## How it works

Each trial: prepare a fresh sandbox (OS tmpdir) → run an agent against a task prompt → evaluate the result three ways (two scores + one set of diagnostics):

| Layer                                   | How                                                                                                                                                                                                                                                                                                                                                                      | Measures                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **Outcome** (score)                     | Deterministic check ladder: `tsc --noEmit` (20) → server starts (20) → expected tools listed via our own `MCPClient` (30) → tool calls return correct results (30). Auth tasks (`auth` in task.json) insert a 5th check — unauthenticated and wrong-token requests must get HTTP 401 — and reweight to 15/15/20/25/25; the grading client then connects with the task's bearer token. | Does it work?                    |
| **Frictions** (diagnostics, not scored) | Deterministic pattern detectors (`raw-sdk-import`, `hand-rolled-content-block`, `missing-zod-schema`, …) — see `src/graders/idiom.ts`. The catalog _is_ our definition of idiomatic mcp-use. Detector hits measure SDK discoverability, not agent quality, so they're reported as findings and tracked as per-detector hit rates over time — never blended into a score. | Where does our API fight agents? |
| **Judge** (score)                       | LLM judge (pinned model) over code + transcript: binary yes/no/unknown assertions (including overall helper/idiom usage) plus process findings (where the agent struggled, hallucinated APIs, skipped self-verification)                                                                                                                                                 | Quality + process                |

Every variant×trial runs in a fresh sandbox; findings aggregate into a per-run `report.md` with a "Top friction points" section — each entry names the improvement lever (docs / skill / SDK / template).

### Variants

A trial runs under a variant = `skill|noskill` × `scaffold|blank`:

- **skill** — `skills/mcp-builder` copied into the sandbox's `.claude/skills/`
- **scaffold** — workspace pre-scaffolded with `create-mcp-use-app` (starter template); **blank** = empty dir, tests discovery from nothing

## Usage

Requires: `ANTHROPIC_API_KEY` — used by both the agent runs (Claude Agent SDK, which bundles its own Claude Code; no local `claude` install or login needed) and the judge. Export it in your shell or put it in `evals/.env` (gitignored; loaded by `pnpm eval`, shell env wins on conflict).

```bash
# from libraries/typescript
pnpm install && pnpm --filter mcp-use build

# smoke-test the graders without an agent (copies the task's golden solution)
pnpm --filter @mcp-use/sdk-evals eval -- --agent golden --skip-judge

# quick single run during iteration
pnpm --filter @mcp-use/sdk-evals eval -- --task 01-basic-tool-server --variant noskill+blank

# recorded run: full matrix, 3 trials per cell
pnpm --filter @mcp-use/sdk-evals eval -- --variant all --trials 3

# cross-run trend table
pnpm --filter @mcp-use/sdk-evals trends
```

Results land in `results/<runId>/` (gitignored), where the run id leads with what ran: `<task|N-tasks>--<variant|all-variants>[--golden]--<timestamp>`, e.g. `01-basic-tool-server--noskill+blank--2026-06-11T18-40-40`. Each run dir holds `run.json` (raw rows), `report.md` (scorecard), and per-trial transcripts + workspace snapshots. **Read the transcripts when a trial fails** — that's how you tell a real agent failure from a grader bug.

## Scoring rules (don't break the trend line)

- Run **≥3 trials** for any run you intend to compare over time; report success rate, not single-trial pass/fail.
- The **judge model is pinned** (`--judge-model`, default in `src/graders/judge.ts`). Changing it re-calibrates the judge trend — do it deliberately and note it.
- **Never edit a task in place** — results carry a `promptHash`; a changed prompt is a different task. Add a new task dir instead.
- Outcome and judge scores are reported separately on purpose. Don't blend them.
- Friction detectors are deliberately unscored — watch per-detector hit rates in `pnpm trends` instead. A new detector changes what's measured; note it when comparing across runs.

## Adding a task

1. `tasks/<nn-name>/prompt.md` — pin the _observable contract_ (exact tool names, behavior, entry file, PORT handling) and leave implementation free, so the deterministic grader never fails a legitimate solution.
2. `tasks/<nn-name>/task.json` — expected tools, fixture calls (`contains` / `not-contains` / `number-equals` expectations; calls run in order on one session, so sequenced calls can assert stateful behavior), valid variants. For auth tasks, add `"auth": { "tokenEnv": "...", "token": "..." }` — the grader sets the env var when starting the server, probes for 401s, and authenticates the tools/calls checks with the token.
3. `tasks/<nn-name>/golden/` — a known-good solution; `--agent golden` must score 100/100 before you trust agent runs.
4. New SDK feature agents should adopt? Add a detector to `src/graders/idiom.ts`.

### Current tasks

| Task                        | Exercises                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `01-basic-tool-server`      | Single tool, zod schema, streamable HTTP, PORT handling — the SDK happy path                                        |
| `02-stateful-notes-server`  | Four CRUD tools over shared in-memory state, sequenced lifecycle calls, "not found" error contract, count reporting |
| `03-authenticated-server`   | Bearer auth from an env token (401 on missing/wrong token), identity propagation into a tool via the auth context   |

## Known v1 limitations

- Runner is Claude Code only (`runClaudeAgent` is a thin interface — Codex/Cursor runners can slot in later). Agent runs load only the sandbox's `.claude/` (`settingSources: ["project"]`), so the local user's `~/.claude` config doesn't leak into trials.
- Everything the harness spawns (agent, graders, the server under test) gets a sanitized environment (`sanitizedEnv()` in `src/proc.ts`): plain `/bin/bash` instead of the user's login shell, no `npm_*`/`PNPM_*` script-context vars, no monorepo `node_modules/.bin` on `PATH`, no inherited `NODE_ENV`. Without this, the user's shell rc and the `pnpm eval` context pollute every Bash result the agent sees (and the judge reads).
- Trials run sequentially (servers bind real ports; agent runs are the bottleneck anyway).
