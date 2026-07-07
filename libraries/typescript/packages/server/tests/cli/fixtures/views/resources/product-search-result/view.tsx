import type { ViewMetadata } from "@mcp-use/server/react";

export const metadata: ViewMetadata = {
  description: "Product search results grid",
  csp: {
    connectDomains: [],
    resourceDomains: ["https://images.example.com"],
  },
  prefersBorder: true,
};

export function Loading() {
  return <div data-testid="loading">Loading…</div>;
}

export default function ProductSearchResult({
  query,
  items,
}: {
  query: string;
  items: { id: string; name: string }[];
}) {
  return (
    <div data-testid="results">
      <p>{query}</p>
      <ul>
        {items.map((item: { id: string; name: string }) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </div>
  );
}
