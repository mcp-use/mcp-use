/** Parse only supported app-relative routes; reject external URLs and fragments. */
export function parseRoute(url: string): {
  page: "books" | "product" | "cart" | "settings" | "missing";
  id?: string;
} {
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("#"))
    return { page: "missing" };
  try {
    const parsed = new URL(url, "https://bookshop.example");
    if (parsed.pathname !== url.split("?")[0]) return { page: "missing" };
    if (parsed.pathname === "/" || parsed.pathname === "/books")
      return { page: "books" };
    if (parsed.pathname === "/cart") return { page: "cart" };
    if (parsed.pathname === "/settings") return { page: "settings" };
    const match = /^\/products\/([a-z0-9-]+)$/.exec(parsed.pathname);
    if (match?.[1]) return { page: "product", id: match[1] };
  } catch {
    /* Invalid host input stays on a recoverable screen. */
  }
  return { page: "missing" };
}

/** Construct a Work web deep link using the registered plugin ID supplied by the user. */
export function pluginLink(pluginId: string, route: string): string {
  return `https://chatgpt.com/plugins/${encodeURIComponent(pluginId)}/app/open_bookshop?path=${encodeURIComponent(route)}`;
}

/** Read search parameters from an app URL without discarding question marks in values. */
export function routeParams(url: string): URLSearchParams {
  return new URLSearchParams(url.split("?").slice(1).join("?"));
}

/** Navigate locally, preserving unrelated query parameters and repeated values. */
export function navigateTo(
  current: string,
  pathname: string,
  patch: Record<string, string | null> = {}
): string {
  const params = routeParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  return pathname + (search ? `?${search}` : "");
}
