---
"@mcp-use/evals": minor
"@mcp-use/inspector": minor
---

Make `@mcp-use/evals` runnable as a GitHub Action and capture token usage.

- **CLI**: new `mcp-use-evals run` bin (suite path, `--server-url`/`--server-config`, `--filter`, `--models`, `--judge-model`, `--max-steps`, `--clients`, `--skip-agent`). Writes `results.json` + `report.md` and emits GitHub Actions outputs (`results_json`, `report_md`, `passed`).
- **GitHub Action**: composite action at `packages/evals/action` wrapping the CLI (mirrors the previous Python `eval-action`; OpenRouter key in, markdown report out).
- **Token metrics**: the inspector LLM layer now emits a `usage` stream event (OpenAI/OpenRouter `stream_options.include_usage`), and the eval judge reads `usage` from its response. `runSuite` aggregates prompt/completion/total tokens (and cost when reported) per scenario and across the suite, implements the `tokensPerSuccessP95Max` gate, and the markdown report shows score badges, per-scenario details, and a tokens column.
- `runSuite` gains `judgeModel`, `maxAgentSteps`, `rubricThreshold`, `models`, and `filter` overrides.
