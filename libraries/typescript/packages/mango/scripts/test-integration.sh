#!/bin/bash
set -e

echo "🧪 Mango v2 Integration Test Suite"
echo "===================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run a test
run_test() {
  local test_name=$1
  local test_command=$2
  
  echo -n "Testing: $test_name... "
  
  if eval "$test_command" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASSED${NC}"
    ((TESTS_PASSED++))
    return 0
  else
    echo -e "${RED}✗ FAILED${NC}"
    ((TESTS_FAILED++))
    return 1
  fi
}

echo "📋 Pre-flight Checks"
echo "-------------------"

# Check Node.js version
run_test "Node.js 20+ installed" "node -v | grep -E 'v(2[0-9]|[3-9][0-9])'"

# Check if pnpm is installed
run_test "pnpm installed" "command -v pnpm"

# Check if E2B CLI is installed
run_test "E2B CLI installed" "command -v e2b || npm list -g @e2b/cli"

echo ""
echo "🔧 Checking Dependencies"
echo "------------------------"

# Check if package.json has required dependencies
run_test "@anthropic-ai/claude-agent-sdk in package.json" "grep -q '@anthropic-ai/claude-agent-sdk' package.json"
run_test "@e2b/code-interpreter in package.json" "grep -q '@e2b/code-interpreter' package.json"
run_test "nanoid in package.json" "grep -q 'nanoid' package.json"

echo ""
echo "📂 File Structure"
echo "-----------------"

# Check if all required files exist
run_test "E2B template script exists" "test -f scripts/create-e2b-template.sh"
run_test "E2B manager exists" "test -f src/server/e2b-manager.ts"
run_test "Agent runtime exists" "test -f src/sandbox-agent/runtime.ts"
run_test "Agent tools exist" "test -f src/sandbox-agent/tools.ts"
run_test "System prompt exists" "test -f src/sandbox-agent/system-prompt.ts"
run_test "Chat API v2 exists" "test -f src/server/routes/chat-v2.ts"
run_test "TodoList component exists" "test -f src/client/components/TodoList.tsx"
run_test "ThinkingBlock component exists" "test -f src/client/components/ThinkingBlock.tsx"
run_test "Setup guide exists" "test -f SETUP.md"

echo ""
echo "🔑 Environment Variables"
echo "------------------------"

# Check for required environment variables
if [ -n "$E2B_API_KEY" ]; then
  echo -e "${GREEN}✓ E2B_API_KEY is set${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${YELLOW}⚠ E2B_API_KEY not set (required for runtime)${NC}"
  ((TESTS_FAILED++))
fi

if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo -e "${GREEN}✓ ANTHROPIC_API_KEY is set${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${YELLOW}⚠ ANTHROPIC_API_KEY not set (required for runtime)${NC}"
  ((TESTS_FAILED++))
fi

if [ -n "$E2B_TEMPLATE_ID" ]; then
  echo -e "${GREEN}✓ E2B_TEMPLATE_ID is set${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${YELLOW}⚠ E2B_TEMPLATE_ID not set (required for runtime)${NC}"
  ((TESTS_FAILED++))
fi

echo ""
echo "🏗️  Build Check"
echo "---------------"

# Try to compile TypeScript (skip if not installed yet)
if command -v tsc > /dev/null 2>&1; then
  run_test "TypeScript compilation" "pnpm exec tsc --noEmit"
else
  echo -e "${YELLOW}⚠ TypeScript not installed yet (run 'pnpm install' first)${NC}"
fi

echo ""
echo "📊 Test Summary"
echo "==============="
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Create E2B template: ./scripts/create-e2b-template.sh"
  echo "2. Set E2B_TEMPLATE_ID in environment"
  echo "3. Run: pnpm dev"
  echo "4. Test at http://localhost:5175"
  exit 0
else
  echo -e "${RED}❌ Some checks failed${NC}"
  echo ""
  echo "Please fix the issues above before proceeding."
  exit 1
fi
