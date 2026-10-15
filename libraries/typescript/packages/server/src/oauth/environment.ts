/** Reads an OAuth provider setting using the v1 environment contract. */
export function oauthEnvironmentValue(name: string): string | undefined {
  // Workers and browsers have no `process` unless a compatibility layer adds it.
  if (typeof process === "undefined" || process.env === undefined) {
    return undefined;
  }
  return process.env[name];
}
