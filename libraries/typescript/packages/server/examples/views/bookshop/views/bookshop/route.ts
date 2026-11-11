/** Accept app-relative URLs without allowing external or normalized path escapes. */
export function appPath(url: string): string {
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("#"))
    return "/not-found";
  try {
    const parsed = new URL(url, "https://bookshop.example");
    if (parsed.pathname === url.split("?")[0]) return url;
  } catch {
    // Invalid incoming URLs use the router's recoverable missing-page screen.
  }
  return "/not-found";
}

/** Construct a Work web deep link using the registered plugin ID supplied by the user. */
export function pluginLink(pluginId: string, route: string): string {
  return `https://chatgpt.com/plugins/${encodeURIComponent(pluginId)}/app/open_bookshop?path=${encodeURIComponent(route)}`;
}
