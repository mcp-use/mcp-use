/** Resolve legacy root callback aliases without redirecting canonical inspector routes. */
export function getDevCallbackRedirect(rawUrl: string): string | null {
  const queryIndex = rawUrl.indexOf("?");
  const path = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const queryString = queryIndex === -1 ? "" : rawUrl.slice(queryIndex);

  if (path === "/oauth/callback") {
    return `/inspector/oauth/callback${queryString}`;
  }
  if (path === "/auth/callback") {
    return `/inspector/auth/callback${queryString}`;
  }
  return null;
}
