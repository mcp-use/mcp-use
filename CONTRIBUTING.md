# Contributing to MCP-Use

Thank you for your interest in contributing to MCP-Use! This document provides guidelines and instructions for contributing to both the Python and TypeScript implementations of MCP-Use.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)

## Code of Conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md) to ensure a welcoming and inclusive environment for all contributors.

## Getting Started

### Prerequisites

- **Git**: Version control
- **Python**: 3.11 or higher (for Python library)
- **Node.js**: 20 or higher (for TypeScript library)
- **pnpm**: 9 or higher (for TypeScript library)

### Repository Structure

This is a monorepo containing both Python and TypeScript implementations:

```
mcp-use-monorepo/
├── libraries/
│   ├── python/        # Python implementation
│   └── typescript/    # TypeScript implementation
├── .github/           # GitHub Actions workflows
└── docs/              # Unified documentation
```

## Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/mcp-use.git
cd mcp-use-monorepo
```

### 2. Install Dependencies

#### Option A: Using Make (Recommended)

```bash
make install
```

#### Option B: Manual Installation

```bash
# Install Python dependencies
cd libraries/python
pip install -e ".[dev,search,e2b]"  # Include optional dependencies

# Install TypeScript dependencies
cd ../typescript
pnpm install
```

### 3. Set Up Pre-commit Hooks (Python)

Pre-commit hooks ensure code quality before committing. The hooks will:

- Format code using Ruff
- Run linting checks
- Check for trailing whitespace and fix it
- Ensure files end with a newline
- Validate YAML files
- Check for large files
- Remove debug statements

```bash
cd libraries/python
pip install pre-commit
pre-commit install
```

### 4. Verify Setup

```bash
# Run tests for both libraries
make test

# Or individually:
make test-python
make test-ts
```

## How to Contribute

### Types of Contributions

We welcome various types of contributions:

- **Bug Fixes**: Help us squash bugs
- **Features**: Implement new features or enhance existing ones
- **Documentation**: Improve or expand our documentation
- **Tests**: Add test coverage
- **Examples**: Create example applications
- **Performance**: Optimize performance
- **Refactoring**: Improve code quality

### Finding Issues

1. Check our [GitHub Issues](https://github.com/mcp-use/mcp-use/issues)
2. Look for issues labeled:
   - `good first issue` - Perfect for newcomers
   - `help wanted` - We need your expertise
   - `python` - Python-specific issues
   - `typescript` - TypeScript-specific issues

### Creating Issues

Before creating an issue:

1. Search existing issues to avoid duplicates
2. Use our issue templates
3. Provide clear reproduction steps for bugs
4. Include relevant system information

## Coding Standards

### Python Guidelines

#### Style Guide

- Follow [PEP 8](https://pep8.org/)
- Use `ruff` for linting and formatting
- Maximum line length: 100 characters

#### Code Quality Tools

```bash
# Format code
cd libraries/python
ruff format .

# Lint code
ruff check .

# Type checking
mypy mcp_use
```

#### Python Best Practices

- Use type hints for all public functions
- Write docstrings for all public modules, classes, and functions (use Google-style)
- Prefer f-strings for string formatting
- Use async/await for asynchronous code
- Follow PEP 8 naming conventions
- Add type hints to function signatures

#### Python Docstring Example

```python
def function_name(param1: type, param2: type) -> return_type:
    """Short description.

    Longer description if needed.

    Args:
        param1: Description of param1
        param2: Description of param2

    Returns:
        Description of return value

    Raises:
        ExceptionType: When and why this exception is raised
    """
```

### TypeScript Guidelines

#### Style Guide

- Follow the project's ESLint configuration
- Use Prettier for formatting
- Use TypeScript strict mode

#### Code Quality Tools

```bash
# Format code
cd libraries/typescript
pnpm format

# Lint code
pnpm lint

# Type checking
pnpm type-check
```

#### TypeScript Best Practices

- Always define explicit types (avoid `any`)
- Use interfaces for object shapes
- Prefer `const` over `let` when possible
- Use async/await over promises when appropriate

## Testing

### Writing Tests

#### Python Tests

```python
# Test file: tests/test_feature.py
import pytest
from mcp_use import Feature

def test_feature_functionality():
    """Test that feature works as expected."""
    feature = Feature()
    result = feature.do_something()
    assert result == expected_value

@pytest.mark.asyncio
async def test_async_feature():
    """Test async functionality."""
    result = await async_feature()
    assert result is not None

@pytest.mark.slow
def test_slow_operation():
    """Test marked as slow for optional execution."""
    # Long-running test code
    pass

@pytest.mark.integration
async def test_integration_feature():
    """Test marked as integration for network-dependent tests."""
    # Integration test code
    pass
```

**Test Organization:**

- Add unit tests in `tests/unit/`
- Add integration tests in `tests/integration/`
- Mark slow or network-dependent tests with `@pytest.mark.slow` or `@pytest.mark.integration`
- Aim for high test coverage of new code

#### TypeScript Tests

```typescript
// Test file: __tests__/feature.test.ts
import { describe, it, expect } from "vitest";
import { Feature } from "../src/feature";

describe("Feature", () => {
  it("should work as expected", () => {
    const feature = new Feature();
    const result = feature.doSomething();
    expect(result).toBe(expectedValue);
  });

  it("should handle async operations", async () => {
    const result = await asyncFeature();
    expect(result).toBeDefined();
  });
});
```

### Running Tests

```bash
# Run all tests
make test

# Run Python tests with coverage
cd libraries/python
pytest --cov=mcp_use --cov-report=html

# Run TypeScript tests with coverage
cd libraries/typescript
pnpm test --coverage

# Run tests in watch mode
make dev
```

## Documentation

### Documentation Standards

- Write clear, concise documentation
- Include code examples
- Update relevant documentation when changing functionality
- Add docstrings/JSDoc comments for all public APIs

### Types of Documentation

1. **API Documentation**: In-code documentation
2. **User Guides**: How-to guides and tutorials
3. **Examples**: Working example applications
4. **README files**: Package and project overviews

### Building Documentation

```bash
# Python documentation (if using Sphinx)
cd libraries/python/docs
make html

# TypeScript documentation (if using TypeDoc)
cd libraries/typescript
pnpm docs
```

## Pull Request Process

### 1. Create a Branch

The `main` branch contains the latest stable code. Create feature or fix branches from `main`:

```bash
# Create a feature branch
git checkout -b feature/your-feature-name

# Or a fix branch
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Write clean, well-documented code
- Follow the coding standards
- Add or update tests
- Update documentation if needed

### 3. Commit Your Changes

Follow conventional commit format (recommended but not strictly enforced):

```bash
# Format: <type>(<scope>): <subject>
git commit -m "feat(python): add new MCP server connection"
git commit -m "fix(typescript): resolve memory leak in agent"
git commit -m "docs: update installation instructions"
```

Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build process or auxiliary tool changes

**Note:** Try to keep your commit messages informational and descriptive of the changes made.

### 4. Push and Create PR

Before pushing, ensure:

- Your code passes all tests
- Pre-commit hooks pass (for Python)
- No linting errors remain

```bash
git push origin your-branch-name
```

Then create a Pull Request on GitHub with:

- Clear title and description
- Link to related issues
- Screenshots/recordings for UI changes
- Test results

### 5. PR Review Process

- PRs require at least one approval
- Address all review comments
- Keep PRs focused and atomic
- Update your branch with main if needed

## Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- MAJOR.MINOR.PATCH (e.g., 2.1.3)
- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes (backward compatible)

### Python Releases

```bash
# Update version in pyproject.toml
# Update CHANGELOG.md
# Create tag
git tag python-v1.2.3
git push origin python-v1.2.3
```

### TypeScript Releases

```bash
# Create changeset
cd libraries/typescript
pnpm changeset

# Version packages
pnpm changeset version

# Commit and push
git commit -m "chore: version packages"
git push
```

## Getting Help

- 💬 [GitHub Discussions](https://github.com/mcp-use/mcp-use/discussions) - Ask questions and share ideas
- 🐛 [GitHub Issues](https://github.com/mcp-use/mcp-use/issues) - Report bugs and request features
- 📧 Email: maintainers@mcp-use.com
- 💼 [Discord](https://discord.gg/mcp-use) - Join our community

## Recognition

Contributors will be recognized in:

- The project README
- Release notes
- Our website's contributors page

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

---

Thank you for contributing to MCP-Use! Your efforts help make this project better for everyone. 🎉
