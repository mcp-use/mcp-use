#!/usr/bin/env bash

# Test script for create-mcp-use-app
# Can be run locally or in CI

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="${TEST_DIR:-/tmp/create-mcp-use-app-test-$$}"

echo -e "${BLUE}🧪 Testing create-mcp-use-app${NC}"
echo -e "${BLUE}Test directory: $TEST_DIR${NC}"
echo ""

# Build and pack the package
echo -e "${YELLOW}📦 Building package...${NC}"
cd "$SCRIPT_DIR"
pnpm build
PACKAGE_PATH=$(npm pack --json | jq -r '.[0].filename')

if [ ! -f "$PACKAGE_PATH" ]; then
    echo -e "${RED}❌ Package not found: $PACKAGE_PATH${NC}"
    exit 1
fi

PACKAGE_FULL_PATH="$SCRIPT_DIR/$PACKAGE_PATH"
echo -e "${GREEN}✅ Package created: $PACKAGE_FULL_PATH${NC}"
echo ""

# Create test directory
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a test
run_test() {
    local test_name="$1"
    local pm="$2"
    local template="$3"
    local flag="$4"
    local install="$5"

    echo -e "${BLUE}🧪 Test: $test_name${NC}"
    echo -e "   Package Manager: $pm"
    echo -e "   Template: $template"
    echo -e "   Flag: ${flag:-none}"
    echo -e "   Install: ${install:-no}"

    local app_name="test-app-$(echo $test_name | tr ' ' '-' | tr '[:upper:]' '[:lower:]')"

    # Remove existing test app
    rm -rf "$app_name"

    # Build command
    local cmd=""

    case "$pm" in
        npm)
            cmd="npx --yes --package=$PACKAGE_FULL_PATH create-mcp-use-app $app_name --template $template $flag $install_flag"
            ;;
        yarn)
            cmd="yarn dlx -p $PACKAGE_FULL_PATH create-mcp-use-app $app_name --template $template $flag $install_flag"
            ;;
        pnpm)
            cmd="pnpm --package=$PACKAGE_FULL_PATH dlx create-mcp-use-app $app_name --template $template $flag $install_flag"
            ;;
    esac

    echo -e "${YELLOW}   Running: $cmd${NC}"

    # Run command
    if eval "$cmd" > /tmp/test-output.log 2>&1; then
        # Verify project was created
        if [ ! -d "$app_name" ]; then
            echo -e "${RED}❌ FAILED: Project directory not created${NC}"
            TESTS_FAILED=$((TESTS_FAILED + 1))
            return 1
        fi

        if [ ! -f "$app_name/package.json" ]; then
            echo -e "${RED}❌ FAILED: package.json not found${NC}"
            TESTS_FAILED=$((TESTS_FAILED + 1))
            return 1
        fi

        if [ ! -f "$app_name/index.ts" ]; then
            echo -e "${RED}❌ FAILED: index.ts not found${NC}"
            TESTS_FAILED=$((TESTS_FAILED + 1))
            return 1
        fi

        # Check expected package manager command in output
        if [ -n "$flag" ]; then
            case "$flag" in
                --yarn)
                    if ! grep -q "yarn dev" /tmp/test-output.log; then
                        echo -e "${RED}❌ FAILED: Expected 'yarn dev' in output${NC}"
                        TESTS_FAILED=$((TESTS_FAILED + 1))
                        return 1
                    fi
                    ;;
                --npm)
                    if ! grep -q "npm run dev" /tmp/test-output.log; then
                        echo -e "${RED}❌ FAILED: Expected 'npm run dev' in output${NC}"
                        TESTS_FAILED=$((TESTS_FAILED + 1))
                        return 1
                    fi
                    ;;
                --pnpm)
                    if ! grep -q "pnpm dev" /tmp/test-output.log; then
                        echo -e "${RED}❌ FAILED: Expected 'pnpm dev' in output${NC}"
                        TESTS_FAILED=$((TESTS_FAILED + 1))
                        return 1
                    fi
                    ;;
            esac
        fi

        # If install was requested, verify node_modules
        if [ "$install" == "yes" ]; then
            if [ ! -d "$app_name/node_modules" ]; then
                echo -e "${RED}❌ FAILED: Dependencies not installed${NC}"
                TESTS_FAILED=$((TESTS_FAILED + 1))
                return 1
            fi
        fi

        # Verify package versions based on flags
        if command -v jq > /dev/null 2>&1; then
            local package_json="$app_name/package.json"

            if grep -q "\-\-dev" <<< "$flag"; then
                # Check for workspace:* versions
                local mcp_use_version=$(jq -r '.dependencies."mcp-use"' "$package_json")
                if [[ "$mcp_use_version" != "workspace:"* ]]; then
                    echo -e "${RED}❌ FAILED: Expected workspace:* version with --dev, got: $mcp_use_version${NC}"
                    TESTS_FAILED=$((TESTS_FAILED + 1))
                    return 1
                fi
                echo -e "${GREEN}   ✓ Verified workspace:* versions${NC}"
            elif grep -q "\-\-canary" <<< "$flag"; then
                # Check for canary versions
                local mcp_use_version=$(jq -r '.dependencies."mcp-use"' "$package_json")
                if [[ "$mcp_use_version" != "canary" ]]; then
                    echo -e "${RED}❌ FAILED: Expected canary version with --canary, got: $mcp_use_version${NC}"
                    TESTS_FAILED=$((TESTS_FAILED + 1))
                    return 1
                fi
                echo -e "${GREEN}   ✓ Verified canary versions${NC}"
            else
                # Check for latest or specific versions (not workspace:* or canary)
                local mcp_use_version=$(jq -r '.dependencies."mcp-use"' "$package_json")
                if [[ "$mcp_use_version" == "workspace:"* ]] || [[ "$mcp_use_version" == "canary" ]]; then
                    echo -e "${RED}❌ FAILED: Expected latest/specific version, got: $mcp_use_version${NC}"
                    TESTS_FAILED=$((TESTS_FAILED + 1))
                    return 1
                fi
                echo -e "${GREEN}   ✓ Verified latest/specific versions${NC}"
            fi
        fi

        echo -e "${GREEN}✅ PASSED${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}❌ FAILED: Command failed${NC}"
        echo -e "${RED}Output:${NC}"
        cat /tmp/test-output.log
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Run tests
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}Running Basic Tests (no install)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""

# Test each template with different package managers
for template in ui uiresource apps_sdk; do
    run_test "NPM-$template" npm "$template" "" ""
    echo ""
    run_test "Yarn-$template" yarn "$template" "" ""
    echo ""
    run_test "PNPM-$template" pnpm "$template" "" ""
    echo ""
done

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}Running Flag Tests${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""

# Test package manager flags
run_test "Flag-Yarn" npm ui "--yarn" ""
echo ""
run_test "Flag-NPM" npm ui "--npm" ""
echo ""
run_test "Flag-PNPM" npm ui "--pnpm" ""
echo ""

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}Running Version Tests${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""

# Test version flags
run_test "Version-Dev" npm ui "--dev" ""
echo ""
run_test "Version-Canary" npm ui "--canary" ""
echo ""
run_test "Version-Latest" npm ui "" ""
echo ""

# Optional: Test with installation (slower)
if [ "${RUN_INSTALL_TESTS:-no}" == "yes" ]; then
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Running Installation Tests (this may take a while)${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo ""

    run_test "Install-NPM" npm ui "--npm" "yes"
    echo ""
    run_test "Install-Yarn" yarn ui "--yarn" "yes"
    echo ""
fi

# Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

# Cleanup
echo -e "${YELLOW}🧹 Cleaning up...${NC}"
cd "$SCRIPT_DIR"
rm -f "$PACKAGE_PATH"
if [ "${KEEP_TEST_DIR:-no}" != "yes" ]; then
    rm -rf "$TEST_DIR"
    echo -e "${GREEN}✅ Cleaned up test directory${NC}"
else
    echo -e "${YELLOW}ℹ️  Test directory preserved: $TEST_DIR${NC}"
fi

echo ""
if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
