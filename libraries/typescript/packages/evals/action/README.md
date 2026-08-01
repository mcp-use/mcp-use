# MCP Server Evals — GitHub Action

A reusable GitHub Action that runs **mcp-use.com/evals/v1** suites against any MCP
server: deterministic protocol checks, multi-turn agent scenarios, an LLM judge,
and (optionally) widget screenshot checks. It wraps the
[`@mcp-use/evals`](https://www.npmjs.com/package/@mcp-use/evals) CLI.

Works with any MCP server — stdio or remote HTTP — and any model available on
OpenRouter. The agent runs the programmatic `mcp-use` client; ChatGPT and the
hosted Inspector clients are available on [mcp-use Cloud](https://mcp-use.com).

## Quick start

1. Commit a suite, e.g. `evals/smoke.suite.yaml`:

```yaml
apiVersion: mcp-use.com/evals/v1
kind: EvalSuite
name: smoke
server:
  url: ${MCP_SERVER_URL}
flows:
  - id: main
    type: agent
    checks:
      - id: tools-listed
        call: { mcp: listTools }
        assert:
          - { kind: jsonpath, path: $, type: number }
    scenarios:
      - id: greet
        turns:
          - user: Say hello and list what you can do.
            expect:
              judge:
                rubric: The assistant greets the user and summarizes its tools.
                threshold: 0.7
```

2. Add the workflow (see [`example-workflow.yml`](./example-workflow.yml)):

```yaml
- uses: mcp-use/eval-action@v1
  id: evals
  with:
    eval_suite: evals/smoke.suite.yaml
    server_url: https://my-server.example.com/mcp
    openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}

- uses: marocchino/sticky-pull-request-comment@v2
  if: always() && github.event_name == 'pull_request'
  with:
    header: mcp-evals
    path: ${{ steps.evals.outputs.report_md }}
```

3. Add `OPENROUTER_API_KEY` under **Settings → Secrets and variables → Actions**.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `eval_suite` | yes | — | Path to the suite YAML (`mcp-use.com/evals/v1`). |
| `openrouter_api_key` | yes | — | OpenRouter key for the agent and the judge. |
| `server_url` | no | — | Remote MCP URL (overrides the suite `server` block). |
| `server_config` | no | — | MCP server config JSON: `{"url": ...}` or `{"command", "args", "env"}`. |
| `filter` | no | — | Only run scenarios whose id contains this substring. |
| `models` | no | — | Comma-separated OpenRouter model ids overriding the suite. |
| `judge_model` | no | — | Judge model override. |
| `max_steps` | no | — | Max agent steps per scenario. |
| `output_dir` | no | `eval-results` | Directory for `results.json` / `report.md`. |
| `evals_version` | no | `latest` | `@mcp-use/evals` version/tag (`latest`, `canary`, or pinned). |
| `node_version` | no | `20` | Node.js version to set up. |

## Outputs

| Output | Description |
| --- | --- |
| `results_json` | Path to `results.json` (full structured results). |
| `report_md` | Path to `report.md` (markdown report for PR comments). |
| `passed` | `"true"` if all evals passed, else `"false"`. |

The step exits non-zero when the suite fails, so gate your merges on it and use
`if: always()` on the comment/summary steps.

## Running locally

The same runner is available as a CLI:

```bash
export OPENROUTER_API_KEY="sk-or-..."
npx @mcp-use/evals run \
  --eval-suite evals/smoke.suite.yaml \
  --server-url https://my-server.example.com/mcp \
  --output eval-results
```

## Source

This action's source lives in the
[`mcp-use/mcp-use`](https://github.com/mcp-use/mcp-use) monorepo at
`libraries/typescript/packages/evals/action`. It is published to the
[`mcp-use/eval-action`](https://github.com/mcp-use/eval-action) repository for
the `mcp-use/eval-action@v1` reference, and can also be used directly from the
monorepo via the full subpath
`mcp-use/mcp-use/libraries/typescript/packages/evals/action@<ref>`.
