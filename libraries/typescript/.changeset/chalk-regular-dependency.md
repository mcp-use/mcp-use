---
"mcp-use": patch
---

Move chalk from optionalDependencies to dependencies. It is statically imported by server code (`src/server/logging.ts`, `src/server/utils/server-lifecycle.ts`), so installs that skip optional packages (`pnpm install --no-optional`, `npm config set optional false`) would fail at module load.
