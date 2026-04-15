/**
 * CommonJS-side Next.js runtime-module shim.
 *
 * Node's ESM loader hooks (registered via `module.register()`) don't
 * intercept CommonJS `require()` calls made by tsx's CJS transformer. tsx
 * compiles TypeScript to CJS by default, so a transitive `import 'server-only'`
 * inside a user tool becomes `require('server-only')` at runtime — which
 * ends up loading the real module and throwing.
 *
 * This file patches `Module._resolveFilename` at require-time so that any
 * CJS `require()` for one of the shimmed specifiers resolves to a sibling
 * no-op module instead.
 *
 * Loaded via `node -r <path>` (or `NODE_OPTIONS=-r <path>`) before the user
 * entry is evaluated. Paired with `next-shims-register.mjs` on the ESM side
 * for belt-and-braces coverage.
 */

const Module = require("node:module");
const path = require("node:path");

// Absolute path to the no-op CJS module that satisfies every shimmed specifier.
const noopPath = path.join(__dirname, "next-shims-noop.cjs");

// Modules we intercept. Keep this list aligned with
// `next-shims-loader.mjs` so ESM and CJS behave identically.
const SHIMMED = new Set([
  "server-only",
  "client-only",
  "next/cache",
  "next/headers",
  "next/navigation",
  "next/server",
]);

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(
  request,
  parent,
  isMain,
  options
) {
  if (SHIMMED.has(request)) {
    return noopPath;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
