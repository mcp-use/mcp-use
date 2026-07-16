import badgeUrl from "./badge.png";

export default function ProductSearchResult({
  query,
  items,
}: {
  query: string;
  items: { id: string; name: string }[];
}) {
  return (
    <div className="grid gap-2" data-testid="results">
      <img src={badgeUrl} alt="" data-testid="badge" />
      <p>{query}</p>
      <ul>
        {items.map((item: { id: string; name: string }) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </div>
  );
}
