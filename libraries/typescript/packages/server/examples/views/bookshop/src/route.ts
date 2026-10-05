/** Parse only supported app-relative routes; reject external URLs and fragments. */
export function parseRoute(url: string): {
  page: "books" | "product" | "cart" | "missing";
  id?: string;
} {
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("#"))
    return { page: "missing" };
  try {
    const parsed = new URL(url, "https://bookshop.example");
    if (parsed.pathname !== url.split("?")[0]) return { page: "missing" };
    if (parsed.pathname === "/books") return { page: "books" };
    if (parsed.pathname === "/cart") return { page: "cart" };
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
