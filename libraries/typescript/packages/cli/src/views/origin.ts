/** Normalize an asset URL prefix by removing trailing slashes. */
export function normalizeAssetsBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
