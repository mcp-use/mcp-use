/**
 * Registers the Next.js server-runtime shim loader.
 *
 * Passed as `node --import=<this-file>` by the CLI when spawning tsx in
 * --no-hmr mode, so the shim loader is active before tsx evaluates the
 * user's MCP server entry.
 *
 * The HMR path calls `module.register()` directly in-process; see
 * cli/src/utils/next-shims.ts.
 */

import { register } from "node:module";

register("./next-shims-loader.mjs", import.meta.url);
