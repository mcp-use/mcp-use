import { useState } from "react";
import { z } from "zod";
import {
  ModelContext,
  useCallTool,
  useView,
  useViewState,
  useViewTool,
} from "@mcp-use/server/react";
import type {
  LoadingProps,
  ViewMetadata,
  ViewProps,
} from "@mcp-use/server/react";

import "./view.css";

export const metadata: ViewMetadata = {
  description: "Product search results grid",
  csp: {
    connectDomains: [],
    resourceDomains: ["https://images.example.com"],
  },
  prefersBorder: true,
};

function SearchSkeleton({
  query,
  pulsing,
}: {
  query?: string;
  pulsing?: boolean;
}) {
  return (
    <div className="view-root">
      <p className="view-query">
        {query ? `Searching for "${query}"…` : "Searching…"}
      </p>
      <div className="skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className={`skeleton-card${pulsing ? " pulsing" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

function ResultsGrid({
  items,
  selected,
  favorites,
  onFavorite,
  onDetails,
  onOpenProducer,
}: {
  items: { id: string; name: string; imageUrl: string }[];
  selected: string | null;
  favorites: string[];
  onFavorite: (id: string) => void;
  onDetails: (fruit: string) => void;
  onOpenProducer: (url: string) => void;
}) {
  return (
    <ul className="results-grid">
      {items.map((item) => (
        <li
          key={item.id}
          className={`fruit-card${selected === item.id ? " selected" : ""}`}
        >
          <img src={item.imageUrl} alt={item.name} />
          <strong>{item.name}</strong>
          <div className="fruit-card-actions">
            <button type="button" onClick={() => onDetails(item.id)}>
              Details
            </button>
            <button
              type="button"
              onClick={() => onFavorite(item.id)}
              disabled={favorites.includes(item.id)}
            >
              {favorites.includes(item.id) ? "Saved" : "Favorite"}
            </button>
            <button
              type="button"
              onClick={() =>
                onOpenProducer(`https://images.example.com/producers/${item.id}`)
              }
            >
              Producer
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DetailsCard({
  data,
}: {
  data: {
    name: string;
    producer: string;
    nutrition: { calories: number; fiber: string };
  };
}) {
  return (
    <div className="details-card">
      <h3>{data.name}</h3>
      <p>
        <strong>Producer:</strong> {data.producer}
      </p>
      <p>
        <strong>Calories:</strong> {data.nutrition.calories}
      </p>
      <p>
        <strong>Fiber:</strong> {data.nutrition.fiber}
      </p>
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-label="Loading details" />;
}

export function Loading({ partialInput, isStreaming }: LoadingProps<"search-fruits">) {
  return (
    <SearchSkeleton
      {...(partialInput?.query !== undefined && { query: partialInput.query })}
      pulsing={isStreaming}
    />
  );
}

export default function ProductSearchResult({
  query,
  items,
}: ViewProps<"search-fruits">) {
  const {
    theme,
    displayMode,
    requestDisplayMode,
    sendFollowUpMessage,
    openExternal,
  } = useView();

  const [favorites, setFavorites] = useViewState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const details = useCallTool("get-fruit-details");

  useViewTool(
    {
      name: "highlight-fruit",
      description: "Highlight a visible result",
      schema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
      setSelected(id);
      return { content: [{ type: "text", text: `Highlighted ${id}` }] };
    }
  );

  return (
    <div className="view-root" data-theme={theme}>
      <ModelContext
        content={`User is viewing results for "${query}"; favorites: ${favorites.join(", ") || "none"}`}
      />

      <header className="view-header">
        <p className="view-query">
          Results for &ldquo;{query}&rdquo; ({items.length})
        </p>
        <div className="view-actions">
          {displayMode === "inline" && (
            <button
              type="button"
              onClick={() => requestDisplayMode({ mode: "fullscreen" })}
            >
              Expand
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              sendFollowUpMessage({ prompt: "Compare my favorite fruits" })
            }
          >
            Compare favorites
          </button>
        </div>
      </header>

      <p className="favorites">
        Favorites: {favorites.length > 0 ? favorites.join(", ") : "none yet"}
      </p>

      <ResultsGrid
        items={items}
        selected={selected}
        favorites={favorites}
        onFavorite={(id) =>
          setFavorites(favorites.includes(id) ? favorites : [...favorites, id])
        }
        onDetails={(fruit) => {
          void details.callTool({ fruit });
        }}
        onOpenProducer={(url) => openExternal({ url })}
      />

      {details.isPending && <Spinner />}
      {details.data && (
        <DetailsCard data={details.data.structuredContent} />
      )}
    </div>
  );
}
