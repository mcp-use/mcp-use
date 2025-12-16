<p align="center">
  <img src="https://cdn.mcp-use.com/github/Contributing.jpg" alt="Contributing to mcp-use" width="100%" />
</p>

# Contributing to mcp-use

Thank you for your interest in contributing to mcp-use! This document provides guidelines for contributing to both the Python and TypeScript libraries.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Repository Structure](#repository-structure)
- [Python Development](#python-development)
- [TypeScript Development](#typescript-development)
- [Pull Request Process](#pull-request-process)
- [Getting Help](#getting-help)

## Code of Conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md) to ensure a welcoming and inclusive environment for all contributors.

## Ways to Contribute

We welcome all kinds of contributions! Here are some ways you can help:

- **Help with issues**: Answer questions, help debug problems, or provide guidance on [GitHub Issues](https://github.com/mcp-use/mcp-use/issues)
- **Fix bugs**: Pick an issue from our [issue tracker](https://github.com/mcp-use/mcp-use/issues) and submit a fix. Issues labeled [`good first issue`](https://github.com/mcp-use/mcp-use/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are great starting points, but don't let that stop you from tackling other issues, many are very approachable!
- **Add new features**: Have an idea? Open an issue to discuss it first, then submit a PR
- **Improve documentation**: Fix typos, clarify explanations, or add examples

If you have any questions or need guidance, join our [Discord](https://discord.gg/XkNkSkMz3V), we're super happy to help!

## Repository Structure

This is a monorepo containing both Python and TypeScript implementations:

```
mcp-use/
├── libraries/
│   ├── python/        # Python library (mcp-use on PyPI)
│   └── typescript/    # TypeScript monorepo (multiple npm packages)
├── docs/              # Documentation
└── .github/           # CI/CD workflows
```

The Python and TypeScript libraries have independent development workflows and release processes.

---

## Python Development

### Prerequisites

- [Python](https://www.python.org/downloads/) 3.11 or higher
- [uv](https://docs.astral.sh/uv/getting-started/installation/) - Fast Python package manager

### Setup

```bash
# Navigate to the Python library
cd libraries/python

# Create and activate a virtual environment
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies with development extras
uv pip install -e ".[dev,anthropic,openai,search,e2b]"
```

### Code Quality

We use **Ruff** for linting and formatting:

```bash
cd libraries/python

# Check linting
ruff check .

# Fix linting issues
ruff check . --fix

# Check formatting
ruff format --check .

# Format code
ruff format .
```

### Pre-commit Hooks (Python)

The Python library has its own pre-commit config at `libraries/python/.pre-commit-config.yaml`:

```bash
cd libraries/python

# Install pre-commit (if not already in your venv)
uv pip install pre-commit

# Install hooks
pre-commit install

# Run manually on all files
pre-commit run --all-files
```

This runs:
- Ruff linting and formatting
- Type checking with ty (excluding tests)
- Trailing whitespace and end-of-file fixes

### Running Tests

```bash
cd libraries/python

# Run all unit tests
pytest tests/unit

# Run with verbose output
pytest -vv tests/unit

# Run with coverage
pytest --cov=mcp_use tests/unit
```

#### Test Categories

Tests are organized into:

- **Unit tests** (`tests/unit/`): Fast, isolated tests
- **Integration tests** (`tests/integration/`):
  - `client/transports/`: Tests for stdio, sse, streamable_http transports
  - `client/primitives/`: Tests for MCP primitives (tools, resources, prompts, etc.)
  - `client/others/`: Other integration tests
  - `agent/`: Agent tests (require API keys)

To run specific integration tests:

```bash
# Transport tests
pytest -vv tests/integration/client/transports/test_stdio.py

# Primitive tests
pytest -vv tests/integration/client/primitives/test_tools.py

# Agent tests (requires OPENAI_API_KEY)
pytest -vv tests/integration/agent/test_agent_run.py
```

### Python Coding Standards

- Follow [PEP 8](https://pep8.org/)
- Maximum line length: 120 characters (configured in `pyproject.toml`)
- Use type hints for all public functions
- Write docstrings using Google-style format
- Use async/await for asynchronous code

```python
def function_name(param1: str, param2: int) -> bool:
    """Short description of what the function does.

    Args:
        param1: Description of param1
        param2: Description of param2

    Returns:
        Description of return value

    Raises:
        ValueError: When and why this exception is raised
    """
```

---

## TypeScript Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or higher (22 recommended)
- [pnpm](https://pnpm.io/installation) 10 or higher

### Monorepo Structure

The TypeScript library is a **pnpm workspace monorepo** containing multiple packages in `libraries/typescript/packages/`:

```
libraries/typescript/
├── package.json          # Root workspace config
├── pnpm-workspace.yaml   # Workspace definition
├── packages/
│   ├── mcp-use/          # Core library (npm: mcp-use)
│   ├── cli/              # CLI tools (npm: @mcp-use/cli)
│   ├── inspector/        # MCP Inspector (npm: @mcp-use/inspector)
│   └── create-mcp-use-app/  # Project scaffolding CLI
```

**How the monorepo works:**

- All packages share the same `node_modules` at the workspace root (efficient disk usage)
- Packages can depend on each other using `workspace:*` protocol
- Running `pnpm install` at the root installs dependencies for all packages
- Running `pnpm build` builds packages in the correct dependency order (`mcp-use` first, then others)

### Setup

```bash
# Navigate to the TypeScript library
cd libraries/typescript

# Install dependencies for all packages
pnpm install

# Build all packages (mcp-use first, then others in parallel)
pnpm build
```

### Working with Packages

Use `pnpm --filter` to run commands in specific packages:

```bash
# Build only the core library
pnpm --filter mcp-use build

# Run tests in inspector package
pnpm --filter @mcp-use/inspector test

# Run a command in all packages
pnpm run -r test
```

### Code Quality

We use **ESLint** for linting and **Prettier** for formatting:

```bash
cd libraries/typescript

# Check formatting
pnpm format:check

# Format code
pnpm format

# Run linter
pnpm lint

# Fix lint issues
pnpm lint:fix
```

### Pre-commit Hooks (TypeScript)

The TypeScript library uses **Husky** + **lint-staged** for pre-commit hooks. When you run `pnpm install`, Husky is automatically set up via the `prepare` script.

The hooks automatically run Prettier and ESLint on staged `.js`, `.jsx`, `.ts`, and `.tsx` files.

### Running Tests

```bash
cd libraries/typescript

# Run all tests across all packages
pnpm test

# Run tests for specific package
pnpm --filter mcp-use test
pnpm --filter @mcp-use/inspector test
pnpm --filter @mcp-use/cli test

# Run unit tests only (mcp-use package)
pnpm --filter mcp-use test:unit

# Run agent integration tests (requires OPENAI_API_KEY)
pnpm --filter mcp-use test:integration:agent
```

### Changesets

**All TypeScript changes require a changeset** describing what changed. This is enforced in CI for PRs to `main`.

```bash
cd libraries/typescript

# Create a changeset
pnpm changeset
```

You'll be prompted to:
1. Select which packages changed
2. Choose the semver bump type (patch/minor/major)
3. Write a summary of changes

Commit the generated `.changeset/*.md` file with your changes.

### TypeScript Coding Standards

- Use TypeScript strict mode
- Always define explicit types (avoid `any`)
- Use interfaces for object shapes
- Prefer `const` over `let`
- Use async/await over raw promises

---

## Pull Request Process

### 1. Create a Branch

```bash
# Create a feature branch from main
git checkout main
git pull origin main
git checkout -b feat/python/your-feature-name
# or
git checkout -b feat/typescript/your-feature-name

# Or a fix branch
git checkout -b fix/python/bug-description
# or
git checkout -b fix/typescript/bug-description
```

### 2. Make Your Changes

- Write clean, well-documented code
- Follow the coding standards for the language
- Add tests for new functionality
- Update documentation if needed

### 3. Commit Your Changes

We recommend (but don't strictly enforce) conventional commit format:

```bash
# Format: <type>(<scope>): <subject>
git commit -m "feat(python): add new MCP server connection"
git commit -m "fix(typescript): resolve memory leak in agent"
git commit -m "docs: update installation instructions"
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### 4. Before Pushing

**For Python changes:**
```bash
cd libraries/python
ruff check .
ruff format --check .
pytest tests/unit
```

**For TypeScript changes:**
```bash
cd libraries/typescript
pnpm format:check
pnpm lint
pnpm build
pnpm changeset  # Create a changeset if not done yet
```

### 5. Push and Create PR

```bash
git push origin your-branch-name
```

Create a Pull Request on GitHub with:
- Clear title and description
- Link to related issues (use "Closes #123")
- Screenshots/recordings for UI changes

### CI Checks

PRs trigger automated checks:

**Python (runs if `libraries/python/**` changed):**
- Linting (ruff check + format check)
- Unit tests (Python 3.11 & 3.12, latest & minimum deps)
- Transport tests (stdio, sse, streamable_http)
- Primitive tests (tools, resources, prompts, etc.)
- Agent tests (requires API keys)

**TypeScript (runs if `libraries/typescript/**` changed):**
- Linting (ESLint)
- Formatting (Prettier)
- Build verification
- Package tests
- Changeset verification (PRs to main only)

---

## Getting Help

- 💬 [GitHub Discussions](https://github.com/mcp-use/mcp-use/discussions) - Ask questions and share ideas
- 🐛 [GitHub Issues](https://github.com/mcp-use/mcp-use/issues) - Report bugs and request features
- 💼 [Discord](https://discord.gg/XkNkSkMz3V) - Join our community

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

---

Thank you for contributing to mcp-use! 🎉
