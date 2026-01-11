# CLAUDE.md

This is the root configuration for Claude Code in the mcp-use monorepo.

## Project Overview

**mcp-use** is a full-stack MCP (Model Context Protocol) framework providing clients, agents, and servers in both Python and TypeScript. This is a widely-used open-source library.

## Repository Structure

```
mcp-use/
├── libraries/
│   ├── python/      → Python library (PyPI: mcp-use)
│   └── typescript/  → TypeScript monorepo (npm: mcp-use, @mcp-use/*)
├── docs/            → Documentation
└── .github/         → CI/CD workflows
```

See language-specific CLAUDE.md files in `libraries/python/` and `libraries/typescript/` for detailed guidance.

---

## CRITICAL: Workflow for Non-Trivial Tasks

**YOU MUST follow this workflow for any task beyond simple fixes:**

### 1. Plan Before Implementing

Before writing any code for a non-trivial task:
- Use plan mode to reason through the approach
- Identify files that need changes
- Consider edge cases and potential issues
- Get explicit user approval before proceeding

### 2. Context Management

When exploring the codebase:
- Read only files directly relevant to the task
- Avoid loading entire directories or large numbers of files
- Use targeted grep/glob searches first
- Summarize findings rather than dumping file contents

### 3. Breaking Changes & Backward Compatibility

**This is a library used by many people. Breaking changes have real impact.**

Before implementing ANY change that modifies public APIs:
- Explicitly identify if it's a breaking change
- Present options to the user in plan mode:
  - Option A: Breaking change (cleaner, but requires user migration)
  - Option B: Backward compatible (may add complexity)
- **DO NOT** automatically add backward compatibility shims, re-exports, or deprecation wrappers
- Let the user decide - often breaking changes are acceptable and preferred over code duplication

### 4. Implementation Requirements

After plan approval:
- Write clean, minimal code that solves the problem
- **Tests are MANDATORY** for new functions/methods/classes
- Tests must verify actual behavior, not just mock everything
- Avoid over-engineering - solve the current problem, not hypothetical future ones

### 5. Post-Implementation Checklist

After implementation is complete:
1. Run the test suite and verify tests pass
2. Check if documentation needs updates (`docs/`, README files, docstrings)
3. Check if examples need updates (`examples/` directories)
4. Prepare a PR description following `.github/pull_request_template.md`

---

## Testing Standards

**Tests are not optional. Fake tests are worse than no tests.**

- Unit tests: Test actual logic, not mocked implementations
- Integration tests: Test real component interactions
- If you're mocking everything, you're testing nothing
- Cover happy paths AND edge cases

---

## PR Description Format

After completing work, provide a PR description following this format:

```markdown
## Changes
[Concise description of what changed]

## Implementation Details
1. [Specific changes made]
2. [Architectural decisions]
3. [Dependencies added/modified]

## Example Usage (Before)
[If applicable]

## Example Usage (After)
[Show the new usage]

## Documentation Updates
- [List updated docs]

## Testing
- [Tests added/modified]
- [How you verified the changes]

## Backwards Compatibility
[Is this breaking? What do users need to do?]

## Related Issues
Closes #[issue_number]
```

---

## Language-Specific Commands

### Python (`libraries/python/`)
```bash
ruff check --fix && ruff format    # Lint and format
pytest tests/unit                   # Run unit tests
```

### TypeScript (`libraries/typescript/`)
```bash
pnpm build                          # Build all packages
pnpm test                           # Run tests
pnpm changeset                      # Create changeset for PR
```

---

## What NOT to Do

- Don't implement features without explicit approval
- Don't add backward compatibility code without asking first
- Don't create tests that only test mocks
- Don't skip documentation updates
- Don't make sweeping refactors alongside feature work
- Don't guess at requirements - ask for clarification
