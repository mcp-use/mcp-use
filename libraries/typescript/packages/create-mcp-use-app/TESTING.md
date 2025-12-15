# Testing create-mcp-use-app

This document describes how to test the `create-mcp-use-app` CLI tool both locally and in CI.

## Local Testing

### Quick Test Script

Use the included test script to run comprehensive tests:

```bash
cd libraries/typescript/packages/create-mcp-use-app
./test-cli.sh
```

This will:
1. Build the package
2. Create a tarball
3. Test all templates with different package managers
4. Test package manager flags
5. Verify output and created files

### Run with Installation Tests (slower)

To also test actual dependency installation:

```bash
RUN_INSTALL_TESTS=yes ./test-cli.sh
```

### Keep Test Directory for Inspection

To preserve the test directory after running:

```bash
KEEP_TEST_DIR=yes ./test-cli.sh
```

## Manual Testing

### 1. Build and Pack

```bash
cd libraries/typescript/packages/create-mcp-use-app
pnpm build
npm pack
```

This creates `create-mcp-use-app-X.X.X.tgz`

### 2. Test with Different Package Managers

**Using npm/npx:**
```bash
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app my-test-app --template ui
```

**Using yarn:**
```bash
yarn dlx -p ./create-mcp-use-app-0.4.3.tgz create-mcp-use-app my-test-app --template ui
```

**Using pnpm:**
```bash
pnpm --package=./create-mcp-use-app-0.4.3.tgz dlx create-mcp-use-app my-test-app --template ui
```

### 3. Test Package Manager Flags

Test that the correct package manager commands are shown in the output:

**Test --yarn flag:**
```bash
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-yarn --template ui --yarn
# Should show: "yarn dev" and "yarn" commands
```

**Test --npm flag:**
```bash
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-npm --template ui --npm
# Should show: "npm run dev" and "npm install" commands
```

**Test --pnpm flag:**
```bash
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-pnpm --template ui --pnpm
# Should show: "pnpm dev" and "pnpm install" commands
```

### 3.5. Test Version Flags

Test that the correct package versions are set in generated `package.json`:

**Test --dev flag (workspace versions):**
```bash
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-dev --template ui --dev
cd test-dev
cat package.json | grep "mcp-use"
# Should show: "mcp-use": "workspace:*"
```

**Test --canary flag:**
```bash
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-canary --template ui --canary
cd test-canary
cat package.json | grep "mcp-use"
# Should show: "mcp-use": "canary"
```

**Test default (latest versions):**
```bash
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-latest --template ui
cd test-latest
cat package.json | grep "mcp-use"
# Should show: "mcp-use": "latest" or a specific version like "^1.2.3"
```

### 4. Test All Templates

```bash
# UI template (with React resources from tools)
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-ui --template ui

# UI Resource template (with standalone resources)
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-uiresource --template uiresource

# Apps SDK template (advanced features)
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-apps-sdk --template apps_sdk
```

### 5. Test Full Installation

Test with actual dependency installation (takes longer):

```bash
npx --yes --package=./create-mcp-use-app-0.4.3.tgz create-mcp-use-app test-full --template ui --yarn

cd test-full
yarn build  # Verify it builds
```

## CI Testing

### GitHub Actions Workflow

The project includes a comprehensive GitHub Actions workflow (`.github/workflows/test-create-mcp-use-app.yml`) that automatically tests:

**Test Matrix:**
- **Operating Systems:** Ubuntu, macOS, Windows
- **Package Managers:** npm, yarn, pnpm
- **Templates:** ui, uiresource, apps_sdk
- **Flags:** default, --yarn, --npm, --pnpm, --dev, --canary

**Test Types:**
1. **Basic Tests** - Create project without installing dependencies
2. **Package Manager Flag Tests** - Verify package manager detection and flags work correctly
3. **Version Flag Tests** - Verify --dev, --canary flags set correct package versions
4. **Full Installation Tests** - Create and install dependencies (slower, runs on subset of matrix)
5. **Build Tests** - Verify the created project can be built

### Workflow Triggers

The workflow runs automatically on:
- Push to `main` or `canary` branches (if files in `create-mcp-use-app/` change)
- Pull requests targeting `main` or `canary` (if files in `create-mcp-use-app/` change)

### Manual Workflow Trigger

You can also manually trigger the workflow from the GitHub Actions tab.

## What to Test

### Core Functionality

- ✅ Package builds successfully
- ✅ All templates create valid projects
- ✅ Required files are generated (package.json, index.ts, etc.)
- ✅ Project structure matches template

### Package Manager Detection

- ✅ `--yarn` flag shows "yarn dev" and "yarn" commands
- ✅ `--npm` flag shows "npm run dev" and "npm install" commands
- ✅ `--pnpm` flag shows "pnpm dev" and "pnpm install" commands
- ✅ Auto-detection works when run via npx/yarn/pnpm
- ✅ No spinner shown for yarn and npm (they have their own progress)
- ✅ Spinner shown for pnpm

### Package Version Management

- ✅ `--dev` flag creates projects with `workspace:*` versions
- ✅ `--canary` flag creates projects with `canary` versions
- ✅ Default (no flag) creates projects with `latest` or specific versions
- ✅ All package dependencies use correct version format

### Cross-Platform

- ✅ Works on Linux (Ubuntu)
- ✅ Works on macOS
- ✅ Works on Windows

### Installation

- ✅ Dependencies install correctly with each package manager
- ✅ Created project builds successfully
- ✅ TypeScript compilation works

## Troubleshooting

### jq not found (for test script)

The test script uses `jq` to parse npm pack output. Install it:

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Windows (with chocolatey)
choco install jq
```

Alternatively, manually specify the package path:

```bash
PACKAGE_PATH="./create-mcp-use-app-0.4.3.tgz" ./test-cli.sh
```

### Permission Denied on Windows

On Windows, you may need to run the test script via Git Bash or WSL.

### Test Directory Not Cleaned Up

If tests fail, the test directory might remain. Clean up manually:

```bash
rm -rf /tmp/create-mcp-use-app-test-*
```

Or keep it for debugging:

```bash
KEEP_TEST_DIR=yes ./test-cli.sh
```

## Adding New Tests

### To add a new test case:

1. Edit `test-cli.sh` and add a new `run_test` call
2. Update `.github/workflows/test-create-mcp-use-app.yml` matrix if needed
3. Test locally first with `./test-cli.sh`
4. Push and verify in CI

### Example:

```bash
run_test "My-New-Test" npm ui "--yarn" ""
```

Parameters:
1. Test name
2. Package manager to run with (npm/yarn/pnpm)
3. Template name
4. Flag (or "" for none)
5. Whether to install ("yes" or "")
