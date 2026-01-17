# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@mcp-use/cli` is a build and deployment tool for MCP (Model Context Protocol) servers. It provides:
- Development server with HMR (Hot Module Reload) for server code
- Widget building via Vite for React-based UI components
- Production builds with TypeScript compilation and widget bundling
- Cloud deployment to mcp-use hosting platform

## Development Commands

```bash
# Build the CLI tool itself
pnpm build

# Run tests
pnpm test          # Run all tests once
pnpm test:watch    # Watch mode

# Development (when working on the CLI)
pnpm dev          # Watch TypeScript compilation
```

## Testing Changes

To test CLI changes locally in a project:

```bash
# In the CLI package directory
pnpm build

# In a test project
node /path/to/cli/dist/index.cjs dev
# or
npx tsx /path/to/cli/src/index.ts dev
```

## Architecture

### Entry Point (`src/index.ts`)

- Uses `commander` for CLI parsing
- Defines 5 main commands: `dev`, `build`, `start`, `deploy`, `login/logout/whoami`
- All commands are self-contained in this file or imported from `src/commands/`

### Core Commands

**`dev` command (lines 834-1197):**
- HMR mode (default): Uses `chokidar` file watcher + dynamic imports to hot-reload server registrations without restarting
- Non-HMR mode (`--no-hmr`): Uses `tsx watch` to restart server process on changes
- Auto-opens inspector at `http://localhost:3000/inspector`
- Sets `globalThis.__mcpUseHmrMode = true` to prevent `MCPServer.listen()` from being called during import

**`build` command (lines 742-832):**
1. Builds widgets first via `buildWidgets()` (generates schemas)
2. Runs `tsc` to compile TypeScript
3. Copies `public/` folder if it exists
4. Creates `dist/mcp-use.json` manifest with widget metadata and build info

**`start` command (lines 1199-1399):**
- Starts production server from `dist/index.js`
- Optional `--tunnel` flag to expose via bore-based tunnel
- Reads/saves tunnel subdomain to `dist/mcp-use.json` for persistence

**`deploy` command (`src/commands/deploy.ts`):**
- Deploys to mcp-use cloud via GitHub integration
- Pre-flight checks for GitHub App access to repository
- Supports project linking (`.mcp-use/project.json`) for redeployments
- Handles environment variables via `--env` or `--env-file`

### Widget Building (`buildWidgets()` function, lines 246-740)

Key flow:
1. Scans `resources/*.tsx` files and `resources/*/widget.tsx` patterns
2. For each widget:
   - Extracts metadata via SSR (`Vite.ssrLoadModule()`) to get `widgetMetadata` export
   - Converts Zod schema (if present) to JSON Schema via `toJSONSchema()`
   - Creates temporary build directory with entry file + Tailwind CSS
   - Builds with Vite (React + Tailwind plugins)
   - Post-processes HTML if `MCP_SERVER_URL` is set (for static deployments)
3. Returns array of `{ name, metadata }` for manifest

**Node.js Package Stubbing:**
- Uses custom Vite plugin (`nodeStubsPlugin`) to stub Node.js-only packages (e.g., `posthog-node`, `path`) for browser builds
- Required because widgets may import server code that references Node.js modules

### Authentication (`src/commands/auth.ts`)

- OAuth-style flow via device code grant
- Stores session token in `~/.mcp-use/session.json` (via `src/utils/session-storage.ts`)
- API client (`src/utils/api.ts`) handles all backend communication

**Environment Variable Configuration:**
- `MCP_API_URL`: Backend API URL (e.g., `http://localhost:8000` or `https://cloud.mcp-use.com/api/v1`)
- `MCP_WEB_URL`: Frontend URL for auth pages (e.g., `http://localhost:3000` or `https://mcp-use.com`)
- For local development: Set both environment variables to match your local setup

### Deployment System (`src/commands/deploy.ts`)

**GitHub Integration:**
- Validates git repository and GitHub remote
- Checks GitHub App installation and repo access
- Prompts user to install/configure GitHub App if needed (via `promptGitHubInstallation()`)
- Links project to deployment via `.mcp-use/project.json` for stable URLs across redeployments

**Progress Display:**
- Streams logs from backend via SSE (Server-Sent Events)
- Uses spinner animation during build phases
- Polls for final deployment status with exponential backoff

## Configuration Files

- **`tsconfig.json`**: TypeScript config for CLI source
  - Target: ES2022
  - Module: ES2022 with `moduleResolution: bundler`
  - Excludes: `**/*.test.ts`

- **`tsup.config.ts`**: Bundles CLI into CJS (for bin execution)
  - Bundles: `chalk`, `open`, `globby` (for better compatibility)
  - Output: `dist/index.cjs` (referenced in `package.json` bin field)

- **`vitest.config.ts`**: Test configuration
  - Tests in: `tests/**/*.test.ts`
  - 30s timeout for integration tests

## Important Implementation Details

### HMR Mode vs Process Restart

HMR mode relies on `MCPServer.syncRegistrationsFrom()` to copy tool/prompt/resource registrations from a freshly imported module to the running server. This preserves WebSocket connections.

The global flag `__mcpUseHmrMode` prevents `MCPServer.listen()` from starting the server during imports:
```typescript
(globalThis as any).__mcpUseHmrMode = true;
```

### Widget Metadata Extraction

Widgets can export `widgetMetadata` with:
```typescript
export const widgetMetadata = {
  title: string,
  description: string,
  props: ZodSchema,  // or inputs (deprecated)
}
```

The CLI:
1. SSR-loads the widget module to extract metadata
2. Converts Zod schemas to JSON Schema for manifest
3. Stores in `dist/mcp-use.json` for runtime consumption

### Static Deployment Support

When `MCP_SERVER_URL` env var is set during build:
- Widget HTML is post-processed to inject:
  - `window.__getFile(filename)` helper for asset paths
  - `window.__mcpPublicUrl` for public asset base URL
  - `<base href="${MCP_SERVER_URL}">` tag

This enables deploying widgets to static hosts (e.g., Supabase Storage) that don't support dynamic asset paths.

## Common Patterns

### Testing a New Command

1. Add command in `src/index.ts` using `program.command()`
2. Extract complex logic to `src/commands/*.ts` if >50 lines
3. Add integration test in `tests/*.test.ts`
4. Run `pnpm build && node dist/index.cjs <command>` to test

### Adding Environment Variable Support

1. Document in README.md under "Environment Variables"
2. Access via `process.env.VAR_NAME` in code
3. For deployment env vars, update `src/commands/deploy.ts` parsing logic

### Debugging Widget Builds

Enable Vite's full logging by removing `logLevel: 'silent'` in `buildWidgets()`. Watch for:
- Plugin resolution errors (Node.js module not stubbed)
- Tailwind scanning issues (check `@source` directives in generated CSS)
- Metadata extraction failures (SSR errors during `ssrLoadModule()`)

## Dependencies

### Key Runtime Dependencies

- **commander**: CLI argument parsing
- **vite** + **@vitejs/plugin-react** + **@tailwindcss/vite**: Widget building
- **chokidar**: File watching for HMR mode
- **tsx**: TypeScript execution for non-HMR mode
- **chalk**: Terminal colors
- **ws**: WebSocket client for deployment log streaming

### Peer Dependencies

Projects using the CLI should have:
- `react` + `react-dom` (^18 or ^19)
- `react-router-dom` (^7.12)

## Testing Strategy

- **Unit tests**: Utility functions (`tests/format.test.ts`, `tests/session-storage.test.ts`)
- **Integration tests**: CLI command execution (`tests/cli-integration.test.ts`)
- **Platform-specific tests**: Windows spawn behavior (`tests/spawn-windows.test.ts`)

Integration tests use actual `spawn()` to test command execution, not mocks.
