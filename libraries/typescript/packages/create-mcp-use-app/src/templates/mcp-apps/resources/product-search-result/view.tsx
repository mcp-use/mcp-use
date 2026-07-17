import { useToolContext } from "mcp-use/react";

export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();

  if (view.status === "pending") {
    return (
      <p>
        Searching{view.toolInput?.query ? ` for ${view.toolInput.query}` : ""}…
      </p>
    );
  }
  if (view.status === "error") return <p>{view.error.message}</p>;

  return (
    <main>
      <h1>Fruit results</h1>
      <ul>
        {view.toolOutput.items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </main>
  );
}
