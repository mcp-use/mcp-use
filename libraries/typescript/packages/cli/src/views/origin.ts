// Keep this normalization rule aligned with the server asset-origin handling
// without importing server runtime code into the CLI package.
/** Normalize an asset URL prefix by removing trailing slashes. */
export function normalizeAssetsBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
