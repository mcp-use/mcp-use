/**
 * @mcp-use/core
 *
 * Shared primitives for the mcp-use TypeScript SDK.
 *
 * This package provides:
 * - Logger / logger: Lightweight universal logger (works in Node.js and browser)
 * - Error classes: ElicitationValidationError, ElicitationTimeoutError, ElicitationDeclinedError
 * - Utility helpers: applyProxyConfig, sanitizeUrl, assert
 */

// ── Logging ──────────────────────────────────────────────────────────────────
export { Logger, logger } from "./logging.js";
export type { LogLevel } from "./logging.js";

// ── Error types ───────────────────────────────────────────────────────────────
export {
  ElicitationDeclinedError,
  ElicitationTimeoutError,
  ElicitationValidationError,
} from "./errors.js";

// ── Utilities ─────────────────────────────────────────────────────────────────
export {
  applyProxyConfig,
  type ProxyConfig,
  type ProxyResult,
} from "./utils/proxy-config.js";

export { sanitizeUrl } from "./utils/url-sanitize.js";
export { assert } from "./utils/assert.js";
export * from "./utils/favicon-detector.js";
export { JSONSchemaToZod } from "./utils/json-schema-to-zod/JSONSchemaToZod.js";
export type { JSONSchema } from "./utils/json-schema-to-zod/Type.js";
export * from "./utils/jsonrpc-helpers.js";
export * from "./types/widget.js";
export { getPackageVersion, VERSION } from "./version.js";


