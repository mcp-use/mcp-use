# CLAUDE.md - TypeScript Library

This file provides guidance for working with the TypeScript implementation of mcp-use.

## Overview

The TypeScript library is a **pnpm workspace monorepo** containing multiple packages for MCP clients, agents, servers, and tooling.

## Package Structure

```
libraries/typescript/
├── packages/
│   ├── mcp-use/           → Core framework (npm: mcp-use)
│   ├── cli/               → Build tools (npm: @mcp-use/cli)
│   ├── inspector/         → Web debugger (npm: @mcp-use/inspector)
│   └── create-mcp-use-app/→ Scaffolding CLI
├── package.json           → Root workspace config
└── pnpm-workspace.yaml    → Workspace definition
```

## Development Commands

```bash
# Install all dependencies
pnpm install

# Build all packages (respects dependency order)
pnpm build

# Build specific package
pnpm --filter mcp-use build
pnpm --filter @mcp-use/cli build

# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter mcp-use test
pnpm --filter mcp-use test:unit
pnpm --filter mcp-use test:integration:agent  # Requires OPENAI_API_KEY

# Linting and formatting
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
```

## Changesets (Required for PRs)

**All changes require a changeset.** This is enforced in CI.

```bash
pnpm changeset
```

Select affected packages, choose semver bump (patch/minor/major), write summary.

## Architecture

### Core Package (`packages/mcp-use/`)

**MCPClient** (`src/client/`)
- Manages MCP server connections
- Handles configuration from files or objects
- Supports multiple concurrent server sessions

**MCPAgent** (`src/agent/`)
- High-level AI agent using LangChain
- Integrates LLMs with MCP tools
- Supports streaming and conversation memory

**MCPServer** (`src/server/`)
- Framework for building MCP servers
- Declarative tool/resource/prompt definitions
- Built-in inspector integration

### Key Patterns

- **TypeScript Strict Mode**: All code uses strict typing
- **Async/Await**: All I/O is asynchronous
- **Zod Validation**: Schema validation for tool inputs
- **Workspace Dependencies**: Use `workspace:*` for internal deps

## Code Style

- ESLint + Prettier (auto-run via Husky pre-commit)
- Explicit types required (avoid `any`)
- Use interfaces for object shapes
- Prefer `const` over `let`
- Async/await over raw promises

## Testing Guidelines

### Test Location
- Unit tests: `packages/*/src/**/*.test.ts`
- Integration tests: `packages/*/tests/`

### Test Requirements
- Test real behavior, not mocked implementations
- Cover error cases and edge conditions
- Integration tests should use actual MCP servers where possible
- Mock only external dependencies (network, file system) when necessary

### Running Tests
```bash
# All tests
pnpm test

# Unit tests only
pnpm --filter mcp-use test:unit

# Watch mode during development
pnpm --filter mcp-use test:watch
```

## Common Tasks

### Adding a New Tool to MCPServer

1. Define tool in server setup with Zod schema
2. Implement handler function
3. Add unit tests for the handler
4. Add integration test with real server
5. Update documentation if public API

### Adding Client Features

1. Modify relevant class in `packages/mcp-use/src/client/`
2. Update TypeScript interfaces as needed
3. Add tests covering new functionality
4. Run full test suite before PR

### Working with Multiple Packages

When changes span packages:
```bash
# Build in correct order
pnpm build

# Test affected packages
pnpm --filter mcp-use test
pnpm --filter @mcp-use/cli test
```

## Pre-commit Hooks

Husky + lint-staged runs automatically on commit:
- Prettier formatting
- ESLint checks

If hooks fail, fix issues before committing.

## Post-Implementation Checklist

After completing any feature or fix:

1. **Build succeeds**: `pnpm build`
2. **Tests pass**: `pnpm test`
3. **Linting passes**: `pnpm lint && pnpm format:check`
4. **Changeset created**: `pnpm changeset`
5. **Documentation updated**: Check README files, JSDoc comments
6. **Examples updated**: Check `examples/` if API changed
7. **PR description ready**: Follow `.github/pull_request_template.md`

## Important Notes

- Node.js 20+ required (22 recommended)
- pnpm 10+ required
- Always run `pnpm build` after pulling changes
- Changeset required for all PRs to main
