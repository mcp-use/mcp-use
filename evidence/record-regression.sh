#!/usr/bin/env bash
set -u

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root/libraries/typescript"
source_file=packages/agent/src/llm/providers/openai-responses.ts
backup=$(mktemp)
cp "$source_file" "$backup"
restore_source() {
  cp "$backup" "$source_file"
  unlink "$backup"
}
trap restore_source EXIT

git show "origin/main:libraries/typescript/$source_file" > "$source_file"
echo "=== upstream main: terminal-event regressions should fail ==="
npx --yes --package=node@22.22.2 --call 'pnpm --filter @mcp-use/agent exec vitest run src/llm/__tests__/openai-responses.test.ts -t "emits an error"'
before_status=$?

restore_source
trap - EXIT
echo "=== candidate fix: terminal-event regressions should pass ==="
npx --yes --package=node@22.22.2 --call 'pnpm --filter @mcp-use/agent exec vitest run src/llm/__tests__/openai-responses.test.ts -t "emits an error"'
after_status=$?

echo "upstream_exit=$before_status fixed_exit=$after_status"
test "$before_status" -ne 0 && test "$after_status" -eq 0
