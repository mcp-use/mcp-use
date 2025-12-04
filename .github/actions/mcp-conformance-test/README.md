# MCP Conformance Test Action

A reusable GitHub Action for running [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) conformance tests against Python and/or TypeScript servers. This action automatically tests your MCP server implementations, posts results to pull requests, and generates badges.

## Features

✅ **Flexible Server Configuration** - Test servers from file paths or pre-running URLs  
✅ **Multi-Language Support** - Works with Python, TypeScript, or both simultaneously  
✅ **Smart PR Comments** - Update or append comments with baseline comparisons  
✅ **Badge Generation** - Create shields.io badges for your README  
✅ **Baseline Comparison** - Compare results against multiple branches (main, develop, etc.)  
✅ **Zero Lock-in** - No assumptions about your repository structure  
✅ **Rich Outputs** - JSON results available for downstream actions

## Quick Start

### Basic Usage (Starting Servers)

```yaml
name: MCP Conformance Tests

on:
  pull_request:
  push:
    branches: [main]

jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run conformance tests
        uses: ./.github/actions/mcp-conformance-test
        with:
          python-server-path: 'src/server.py'
          typescript-server-path: 'src/server.ts'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Using Pre-Running Servers

```yaml
- name: Start servers
  run: |
    python src/server.py --port 8000 &
    node src/server.js &
    sleep 5

- name: Run conformance tests
  uses: ./.github/actions/mcp-conformance-test
  with:
    python-server-url: 'http://localhost:8000/mcp'
    typescript-server-url: 'http://localhost:3000/mcp'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

### Python Server Configuration

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `python-server-path` | Path to Python server file (e.g., `server/conformance_server.py`) | No | - |
| `python-server-url` | URL of running Python server (e.g., `http://localhost:8000/mcp`) | No | - |
| `python-server-port` | Port for Python server when starting from path | No | `8000` |
| `python-working-directory` | Working directory for Python server | No | `.` |
| `python-install-command` | Command to install Python dependencies | No | - |

### TypeScript Server Configuration

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `typescript-server-path` | Path to TypeScript server file (e.g., `server/conformance_server.ts`) | No | - |
| `typescript-server-url` | URL of running TypeScript server (e.g., `http://localhost:3000/mcp`) | No | - |
| `typescript-server-port` | Port for TypeScript server when starting from path | No | `3000` |
| `typescript-working-directory` | Working directory for TypeScript server | No | `.` |
| `typescript-install-command` | Command to install TypeScript dependencies | No | - |

### PR Comment Configuration

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `comment-on-pr` | Whether to comment on pull requests with test results | No | `true` |
| `comment-mode` | Comment mode: `update` (overwrite) or `append` (new comment per run) | No | `update` |

### Other Configuration

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `baseline-branches` | Comma-separated list of branches to compare against | No | `main` |
| `enable-badge` | Generate badge data for shields.io | No | `true` |
| `github-token` | GitHub token for API access | No | `${{ github.token }}` |

**Note:** You must specify at least one server (either Python or TypeScript, either path or URL).

## Outputs

| Output | Description |
|--------|-------------|
| `python-results` | JSON object with Python test results |
| `typescript-results` | JSON object with TypeScript test results |
| `python-pass-rate` | Python pass rate percentage |
| `typescript-pass-rate` | TypeScript pass rate percentage |
| `badge-data` | JSON data for shields.io badge generation |

### Using Outputs

```yaml
- name: Run conformance tests
  id: conformance
  uses: ./.github/actions/mcp-conformance-test
  with:
    python-server-path: 'src/server.py'
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Check pass rate
  run: |
    echo "Python pass rate: ${{ steps.conformance.outputs.python-pass-rate }}%"
    if [ "${{ steps.conformance.outputs.python-pass-rate }}" -lt 80 ]; then
      echo "❌ Pass rate below threshold!"
      exit 1
    fi
```

## Examples

### Example 1: Python Server with Custom Setup

```yaml
- name: Set up Python
  uses: actions/setup-python@v5
  with:
    python-version: '3.12'

- name: Run conformance tests
  uses: ./.github/actions/mcp-conformance-test
  with:
    python-server-path: 'src/my_server.py'
    python-working-directory: 'backend'
    python-install-command: 'pip install -e .[dev]'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Example 2: TypeScript Server with pnpm

```yaml
- name: Install pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 9

- name: Run conformance tests
  uses: ./.github/actions/mcp-conformance-test
  with:
    typescript-server-path: 'packages/server/src/index.ts'
    typescript-working-directory: 'packages/server'
    typescript-install-command: 'pnpm install'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Example 3: Both Servers with Multiple Baseline Branches

```yaml
- name: Run conformance tests
  uses: ./.github/actions/mcp-conformance-test
  with:
    python-server-path: 'server/python_server.py'
    typescript-server-path: 'server/ts_server.ts'
    baseline-branches: 'main,develop,staging'
    comment-mode: 'append'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Example 4: Append Mode with Badge Generation

```yaml
- name: Run conformance tests
  uses: ./.github/actions/mcp-conformance-test
  with:
    python-server-path: 'src/server.py'
    comment-mode: 'append'
    enable-badge: true
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Display badge URLs
  run: |
    cat conformance-results/badge-data.json | jq '.urls'
```

### Example 5: Using Pre-Started Servers (More Control)

```yaml
- name: Set up environment
  run: |
    # Set up Python
    python -m pip install -e .
    
    # Set up TypeScript
    npm install
    npm run build

- name: Start servers
  run: |
    python src/server.py --transport streamable-http --port 8000 &
    PYTHON_PID=$!
    
    node dist/server.js --port 3000 &
    NODE_PID=$!
    
    echo "PYTHON_PID=$PYTHON_PID" >> $GITHUB_ENV
    echo "NODE_PID=$NODE_PID" >> $GITHUB_ENV
    
    # Wait for servers
    sleep 5

- name: Run conformance tests
  uses: ./.github/actions/mcp-conformance-test
  with:
    python-server-url: 'http://localhost:8000/mcp'
    typescript-server-url: 'http://localhost:3000/mcp'
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Cleanup
  if: always()
  run: |
    kill $PYTHON_PID $NODE_PID || true
```

## PR Comment Format

The action posts formatted comments to pull requests with:

- **Visual summary** with MCP logo
- **Pass rates** for Python and TypeScript servers
- **Baseline comparisons** showing improvements or regressions
- **Individual test results** with checkmarks (✅) and crosses (❌)
- **Change indicators** (+1/-1) for tests that changed from baseline
- **Link to full workflow run** for detailed logs

Example comment:

```markdown
## 🔧 MCP Conformance Test Results

**Commit:** `abc1234`

| Server | Overall | vs main | test_simple_text | test_image | test_error_handling |
|--------|:-------:|:-------:|:----------------:|:----------:|:-------------------:|
| Python | 95.2% | 🟢 +2 | ✅ +1 | ✅ | ✅ |
| TypeScript | 90.0% | ⚪ +0 | ✅ | ❌ | ✅ +1 |

[View full run details](https://github.com/...)
```

## Badge Generation

When `enable-badge` is set to `true`, the action generates badge data compatible with [shields.io](https://shields.io/).

The badge data includes:
- Individual badges for Python and TypeScript
- Combined badge showing overall results
- Pre-formatted URLs ready to use in README

Example usage in your README:

```markdown
![MCP Conformance](https://img.shields.io/endpoint?url=...)
```

Badge colors automatically adjust based on pass rate:
- 🟢 Bright Green (≥90%)
- 🟢 Green (≥75%)
- 🟡 Yellow-Green (≥60%)
- 🟡 Yellow (≥50%)
- 🟠 Orange (≥25%)
- 🔴 Red (<25%)

## Requirements

- **Node.js 22** (automatically set up by the action)
- **Python 3.x** (if testing Python servers)
- **TypeScript/Node** (if testing TypeScript servers)
- **MCP Conformance CLI** (`@modelcontextprotocol/conformance` - installed automatically)

## Troubleshooting

### Server Fails to Start

If your server fails to start, check:
1. Server logs in `conformance-results/{language}-server.log`
2. Dependencies are installed correctly
3. Port is not already in use
4. Server file path is correct relative to working directory

### No PR Comment Posted

If comments aren't appearing:
1. Ensure `github-token` has `pull-requests: write` permission
2. Check that the action is running on a pull request event
3. Verify `comment-on-pr` is set to `true` (default)

### Baseline Comparison Not Working

If baseline comparisons aren't showing:
1. Ensure the workflow has run successfully on the baseline branch
2. Check that artifacts were uploaded in the baseline run
3. Verify branch names in `baseline-branches` are correct

### Test Results Not Found

If results aren't being parsed:
1. Check that the conformance CLI installed correctly
2. Verify server URLs are accessible
3. Look for errors in the conformance test output

## Publishing to GitHub Marketplace (Optional)

To make this action available to others via GitHub Marketplace:

1. Move the action to its own repository
2. Update paths in examples to reference the new repo
3. Create a release with semantic versioning (e.g., `v1.0.0`)
4. Add the `action.yml` to the repository root
5. Enable GitHub Marketplace publishing in repository settings

Reference it as:

```yaml
uses: your-username/mcp-conformance-test@v1
```

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This action is part of the [mcp-use](https://github.com/modelcontextprotocol/mcp-use) project.

## Related Links

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [MCP Conformance Test Suite](https://www.npmjs.com/package/@modelcontextprotocol/conformance)
- [mcp-use Documentation](https://mcp-use.com/)

