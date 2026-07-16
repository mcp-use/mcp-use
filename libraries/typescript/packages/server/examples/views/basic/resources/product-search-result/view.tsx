import { useState } from "react";
import { z } from "zod";
import {
  Image,
  ModelContext,
  ThemeProvider,
  ToolError,
  ViewControls,
  useCallTool,
  useDisplayMode,
  useOpenExternal,
  useSendFollowUp,
  useToolContext,
  useViewTheme,
  useViewTool,
} from "mcp-use/react";

import "./view.css";

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
  items: { id: string; name: string }[];
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
          <Image
            src={`/fruits/${item.id}.png`}
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
                onOpenProducer(
                  `https://images.example.com/producers/${item.id}`
                )
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

function ProductSearchResultContent() {
  const view = useToolContext<"search-fruits">();
  const theme = useViewTheme();
  const { displayMode, availableDisplayModes, requestDisplayMode } =
    useDisplayMode();
  const sendFollowUpMessage = useSendFollowUp();
  const openExternal = useOpenExternal();

  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const details = useCallTool("get-fruit-details");

  useViewTool(
    {
      name: "highlight-fruit",
      description: "Highlight a visible result",
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
      setSelected(id);
      return { content: [{ type: "text", text: `Highlighted ${id}` }] };
    }
  );

  const root = theme === "dark" ? `dark ${rootClass}` : rootClass;

  if (view.status === "streaming") {
    return (
      <SearchSkeleton
        {...(view.toolInput?.query !== undefined && {
          query: view.toolInput.query,
        })}
        pulsing
      />
    );
  }

  if (view.status === "cancelled") {
    return (
      <div className={root}>
        <p className="m-0 font-medium">Search cancelled</p>
        {typeof view.reason === "string" && view.reason.length > 0 ? (
          <p className="mt-2 mb-0 text-sm text-neutral-600 dark:text-neutral-400">
            {view.reason}
          </p>
        ) : null}
      </div>
    );
  }

  if (view.status === "error") {
    return (
      <div className={root} role="alert">
        <p className="m-0 font-medium">
          {view.error instanceof ToolError
            ? "Search failed"
            : "Invalid tool result"}
        </p>
        <p className="mt-2 mb-0 text-sm text-neutral-600 dark:text-neutral-400">
          {view.error.message}
        </p>
      </div>
    );
  }

  if (view.status === "pending") {
    return (
      <SearchSkeleton
        {...(view.toolInput?.query !== undefined && {
          query: view.toolInput.query,
        })}
      />
    );
  }

  const { query, items } = view.toolOutput;
  const detailsData = details.data?.structuredContent;
  const detailsErrorText = details.error?.message;

  return (
    <div className={root}>
      <ModelContext
        content={`User is viewing results for "${query}"; favorites: ${favorites.join(", ") || "none"}`}
      />

      <header className="mb-4 flex flex-wrap items-center gap-2">
        <p className="m-0 text-lg">
          Results for &ldquo;{query}&rdquo; ({items.length})
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          {displayMode === "inline" &&
            availableDisplayModes.includes("fullscreen") && (
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  void requestDisplayMode({ mode: "fullscreen" });
                }}
              >
                Expand
              </button>
            )}
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              void sendFollowUpMessage({
                prompt: "Compare my favorite fruits",
              });
            }}
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
        onOpenProducer={(url) => {
          void openExternal({ url });
        }}
      />

      {details.isPending && <Spinner />}
      {detailsData !== undefined && <DetailsCard data={detailsData} />}
      {detailsErrorText !== undefined && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {detailsErrorText}
        </p>
      )}
    </div>
  );
}

/**
 * Fruit-store search results. No `viewConfig` export — defaults apply
 * (`autoResize: true`, all standard display modes). Theme and debug controls
 * are composed directly (there is no `McpUseProvider`).
 */
export default function ProductSearchResult() {
  return (
    <ThemeProvider>
      <ViewControls debugger>
        <ProductSearchResultContent />
      </ViewControls>
    </ThemeProvider>
  );
}
