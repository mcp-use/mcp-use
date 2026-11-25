/**
 * Skeleton marker. Every skeleton body calls `notBuilt("WP-nn")`; the work
 * package named owns the file. `scripts/check-not-built.mjs` lists them.
 *
 * @internal
 */
export function notBuilt(wp: string): never {
  throw new Error(`mcp-use events: not built yet (${wp})`);
}
