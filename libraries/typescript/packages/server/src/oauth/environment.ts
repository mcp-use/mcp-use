/** Reads an OAuth provider setting using the v1 environment contract. */
export function oauthEnvironmentValue(name: string): string | undefined {
  return process.env[name];
}
