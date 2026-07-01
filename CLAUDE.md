# CLAUDE.md

This is the root configuration for Claude Code in the mcp-use monorepo.

## Project Overview

**mcp-use** is a full-stack MCP (Model Context Protocol) framework providing clients, agents, and servers in both Python and TypeScript.

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

## Current Context: v2 Migration

**The TypeScript library is mid-migration to v2 (alpha).** This is an active, sanctioned breaking-change effort — not incidental churn. Two things are happening at once:

1. **Code quality cleanup** — untangling accumulated coupling, dead code, and inconsistent patterns across the TS packages.
2. **Migrating to the v2 `@modelcontextprotocol/sdk` TypeScript SDK** — the current dependency is v1 (`1.26.0`); the goal is to move onto the official SDK's v2 line as it becomes the foundation.

**What this means for how you work here:**

- **Breaking changes are the default, not the exception.** Don't stop to present "Option A: breaking / Option B: backward-compatible" for every API change during this migration — assume breaking is fine unless the user says otherwise. Do not add backward-compatibility shims, re-exports, or deprecation wrappers unless explicitly asked.
- **Sweeping refactors are in scope.** Code-quality cleanup alongside migration work is the point of this phase, not scope creep to avoid.
- **Branch target for v2 work is `v2` (remote `canary-v2`), not `canary`.** `canary` only receives v2 in one big merge at release time. If you're unsure which branch a v2-era change should target, ask.
- Changesets are still required before a PR lands on `v2` — don't skip them just because the change is breaking.
- For well-scoped, mechanical migration/cleanup work, a brief confirmation of the approach is enough — you don't need a full plan-mode cycle for every file. Reserve deeper up-front planning for genuinely ambiguous or architecturally significant changes (e.g. package boundaries, public API shape).

---

## Testing Standards

**Tests are not optional. Fake tests are worse than no tests.**

- Unit tests: test actual logic, not mocked implementations.
- Integration tests: test real component interactions.
- If you're mocking everything, you're testing nothing.
- Cover happy paths AND edge cases.
- When migration work removes or reshapes a public API, update or delete its tests in the same change rather than leaving them testing a shim.

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

- Don't add backward-compatibility shims or deprecation wrappers during the v2 migration without being asked.
- Don't create tests that only test mocks.
- Don't guess at requirements when genuinely ambiguous — ask.
