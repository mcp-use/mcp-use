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

const rootClass =
  "p-4 font-sans bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100";

const buttonClass =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800";

const cardClass =
  "flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700";

function SearchSkeleton({
  query,
  pulsing,
}: {
  query?: string;
  pulsing?: boolean;
}) {
  return (
    <div className={rootClass}>
      <p className="mb-4 text-lg">
        {query ? `Searching for "${query}"…` : "Searching…"}
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className={`h-40 rounded-lg bg-neutral-200 dark:bg-neutral-800${
              pulsing ? " animate-pulse" : ""
            }`}
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
    <ul className="mb-4 grid list-none grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 p-0">
      {items.map((item) => (
        <li
          key={item.id}
          className={`${cardClass}${
            selected === item.id ? " ring-2 ring-blue-600" : ""
          }`}
        >
          <img
            src={item.imageUrl}
            alt={item.name}
            className="aspect-square w-full rounded-md bg-neutral-100 object-cover dark:bg-neutral-800"
          />
          <strong>{item.name}</strong>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={`${buttonClass} min-w-16 flex-1 px-2 py-1 text-xs`}
              onClick={() => onDetails(item.id)}
            >
              Details
            </button>
            <button
              type="button"
              className={`${buttonClass} min-w-16 flex-1 px-2 py-1 text-xs disabled:opacity-50`}
              onClick={() => onFavorite(item.id)}
              disabled={favorites.includes(item.id)}
            >
              {favorites.includes(item.id) ? "Saved" : "Favorite"}
            </button>
            <button
              type="button"
              className={`${buttonClass} min-w-16 flex-1 px-2 py-1 text-xs`}
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
    <div className={`${cardClass} mb-4`}>
      <h3 className="text-base font-semibold">{data.name}</h3>
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
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-600 dark:border-neutral-600"
      aria-label="Loading details"
    />
  );
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
    <div className={theme === "dark" ? `dark ${rootClass}` : rootClass}>
      <ModelContext
        content={`User is viewing results for "${query}"; favorites: ${favorites.join(", ") || "none"}`}
      />

      <header className="mb-4 flex flex-wrap items-center gap-2">
        <p className="m-0 text-lg">
          Results for &ldquo;{query}&rdquo; ({items.length})
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          {displayMode === "inline" && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => requestDisplayMode({ mode: "fullscreen" })}
            >
              Expand
            </button>
          )}
          <button
            type="button"
            className={buttonClass}
            onClick={() =>
              sendFollowUpMessage({ prompt: "Compare my favorite fruits" })
            }
          >
            Compare favorites
          </button>
        </div>
      </header>

      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
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
