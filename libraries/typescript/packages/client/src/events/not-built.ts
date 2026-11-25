/**
 * Skeleton marker; the named work package owns the calling file.
 *
 * @internal
 */
export function notBuilt(wp: string): never {
  throw new Error(`@mcp-use/client events: not built yet (${wp})`);
}
