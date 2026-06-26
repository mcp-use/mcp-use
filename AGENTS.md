# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a monorepo with two independent library codebases:
- **TypeScript** (`libraries/typescript/`) — pnpm workspace monorepo (packages: `mcp-use`, `@mcp-use/cli`, `@mcp-use/inspector`, `create-mcp-use-app`)
- **Python** (`libraries/python/`) — single package (`mcp-use` on PyPI)

No external services or databases are required for development. Test suites are self-contained (spawn in-process test servers). Agent integration tests (`tests/integration/agent/`) require `OPENAI_API_KEY` and are expected to fail without it.

### TypeScript

- Commands are run from `libraries/typescript/`.
- After `pnpm install`, you must run `pnpm build` before running tests or examples. The build must happen before install symlinks work correctly (bin entries like `mcp-use` depend on `dist/` output).
- After building, re-run `pnpm install` to regenerate bin symlinks for workspace packages — otherwise example commands like `mcp-use dev` will fail with `ENOENT`.
- Lint: `pnpm lint` and `pnpm format:check`
- Tests: `pnpm test` (unit + integration; agent tests require `OPENAI_API_KEY`)
- Unit tests only: `pnpm --filter mcp-use test:unit`
- Build: `pnpm build`
- Husky pre-commit hook enforces formatting, linting, and changeset presence. Use `git commit --no-verify` to skip when committing non-code changes.

### Python

- Commands are run from `libraries/python/`.
- Virtual environment at `libraries/python/.venv` (activate with `source .venv/bin/activate`).
- Lint: `ruff check .` and `ruff format --check .`
- Tests: `pytest tests/unit` (unit), `pytest tests/integration/client/` (transport/primitive tests, no API keys needed)
- The single expected test failure `test_create_sandboxed_stdio_connector` requires the optional `e2b` dependency.

### Running MCP Server Examples (TypeScript)

To run the simple example server: `pnpm --filter simple-example dev` from `libraries/typescript/`. The server starts at `http://localhost:3000` with an inspector at `/inspector` and MCP endpoint at `/mcp`.

### Gotchas

- The `pnpm install` warning about ignored build scripts (e.g. `@scarf/scarf`, `protobufjs`, `sharp`) is expected; the `onlyBuiltDependencies` allowlist in `pnpm-workspace.yaml` controls which packages can run build scripts.
- `uv` is installed via pip and lives at `~/.local/bin/uv`; ensure `PATH` includes `~/.local/bin` if calling `uv` directly.
