#!/usr/bin/env bash
# Run agent examples that work with OPENAI_API_KEY + local/simple MCP servers.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required for example:verify"
  exit 1
fi

export AGENT_EXAMPLE_DEMO=1

run() {
  echo "==> $1"
  pnpm exec tsx "$1"
}

run examples/basic/simplified_agent_example.ts
run examples/basic/chat_example.ts
run examples/advanced/stream_example.ts
run examples/integrations/filesystem_use.ts

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  run examples/frameworks/ai_sdk_example.ts
  run examples/code-mode/code_mode_example.ts
else
  echo "Skipping Anthropic examples (ANTHROPIC_API_KEY unset)"
fi

echo "Core examples passed."
