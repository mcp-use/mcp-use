import {
  Image,
  ModelContext,
  ThemeProvider,
  ViewControls,
  useCallTool,
  useDisplayMode,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useToolContext,
  useViewTheme,
  useViewTool,
} from "mcp-use/react";
import { useCallback, useState } from "react";
import { z } from "zod";

import { Accordion } from "./components/Accordion.js";
import { Carousel } from "./components/Carousel.js";
import { CarouselSkeleton } from "./components/CarouselSkeleton.js";
import "./view.css";

const shellClass =
  "relative rounded-3xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900";

const iconButtonClass =
  "rounded-full border border-neutral-300 p-2 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800";

function HeartIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function PipIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <rect x="13" y="11" width="7" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ProductSearchResultContent() {
  const view = useToolContext<"search-fruits">();
  const theme = useViewTheme();
  const { locale, hostCapabilities } = useHostContext();
  const { displayMode, availableDisplayModes, requestDisplayMode } =
    useDisplayMode();
  const sendFollowUp = useSendFollowUp();
  const openExternal = useOpenExternal();

  const [favorites, setFavorites] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const details = useCallTool("get-fruit-details");

  useViewTool(
    {
      name: "highlight-fruit",
      description: "Highlight a visible result in the carousel",
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
      setHighlighted(id);
      return { content: [{ type: "text", text: `Highlighted ${id}` }] };
    }
  );

  const toggleFavorite = useCallback((fruit: string) => {
    setFavorites((current) =>
      current.includes(fruit)
        ? current.filter((f) => f !== fruit)
        : [...current, fruit]
    );
  }, []);

  const accordionItems = [
    {
      question: "Demo of the autosize feature",
      answer:
        "This is a demo of the autosize feature. The view will automatically resize to fit the content, as supported by the MCP Apps specification.",
    },
  ];

  const root = theme === "dark" ? "dark" : "";
  const lang = locale?.split("-")[0] ?? "en";
  const isFullscreen = displayMode === "fullscreen";
  const isPip = displayMode === "pip";

  if (view.status === "error") {
    return (
      <div className={`${root} ${shellClass} p-8`} role="alert">
        <p className="m-0 font-medium text-neutral-900 dark:text-neutral-100">
          Search failed
        </p>
        <p className="mt-2 mb-0 text-sm text-neutral-600 dark:text-neutral-400">
          {view.error.message}
        </p>
      </div>
    );
  }

  if (view.status === "pending") {
    return (
      <div className={`${root} ${shellClass}`}>
        <div className="p-8 pb-4">
          <h5 className="mb-1 text-sm text-neutral-500 dark:text-neutral-400">
            MCP-Apps Template
          </h5>
          <h2 className="mb-3 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Lovely Little Fruit Shop
          </h2>
          <div className="h-5 w-48 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800" />
        </div>
        <CarouselSkeleton />
      </div>
    );
  }

  const { query, results } = view.toolOutput;
  const selectedFruit = details.data?.structuredContent;
  const isLoadingDetails = details.isPending;

  return (
    <div className={`${root} ${shellClass}`}>
      <ModelContext
        content={`User is viewing results for "${query}"; favorites: ${favorites.join(", ") || "none"}`}
      />

      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <span className="rounded-full px-2.5 py-1 text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          {lang}
        </span>

        {favorites.length > 0 && (
          <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-red-500">
            <HeartIcon filled />
            {favorites.length}
          </span>
        )}

        {!isFullscreen && !isPip && (
          <>
            {availableDisplayModes.includes("pip") && (
              <button
                type="button"
                className={iconButtonClass}
                title="Picture-in-picture"
                onClick={() => {
                  void requestDisplayMode({ mode: "pip" });
                }}
              >
                <PipIcon />
              </button>
            )}
            {availableDisplayModes.includes("fullscreen") && (
              <button
                type="button"
                className={iconButtonClass}
                title="Fullscreen"
                onClick={() => {
                  void requestDisplayMode({ mode: "fullscreen" });
                }}
              >
                <ExpandIcon />
              </button>
            )}
          </>
        )}

        {(isFullscreen || isPip) && (
          <button
            type="button"
            className={iconButtonClass}
            title="Exit"
            onClick={() => {
              void requestDisplayMode({ mode: "inline" });
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="p-8 pb-4">
        <h5 className="mb-1 text-sm text-neutral-500 dark:text-neutral-400">
          MCP-Apps Template
        </h5>
        <h2 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Lovely Little Fruit Shop
        </h2>
        <p className="text-base text-neutral-600 dark:text-neutral-400">
          {query
            ? `Showing results for "${query}"`
            : "Tap a fruit to see details"}
        </p>
      </div>

      <Carousel
        results={results}
        favorites={favorites}
        highlighted={highlighted}
        onSelectFruit={(fruit: string) => {
          void details.callTool({ fruit });
        }}
        onToggleFavorite={toggleFavorite}
      />

      {selectedFruit && (
        <div className="mx-8 my-6 flex items-center gap-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-700 dark:bg-neutral-950">
          <div
            className={`shrink-0 rounded-xl p-4 ${
              results.find((r) => r.fruit === selectedFruit.fruit)?.color ?? ""
            }`}
          >
            <Image
              src={`/fruits/${selectedFruit.fruit}.webp`}
              alt={selectedFruit.fruit}
              className="h-24 w-24 object-contain"
            />
          </div>
          <div className="flex-1">
            {isLoadingDetails ? (
              <div className="h-4 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-lg font-semibold capitalize">
                    {selectedFruit.fruit}
                  </h3>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(selectedFruit.fruit)}
                    className={`rounded-full p-1 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      favorites.includes(selectedFruit.fruit)
                        ? "text-red-500"
                        : "text-neutral-500"
                    }`}
                    title={
                      favorites.includes(selectedFruit.fruit)
                        ? "Remove from favorites"
                        : "Add to favorites"
                    }
                  >
                    <HeartIcon
                      filled={favorites.includes(selectedFruit.fruit)}
                    />
                  </button>
                </div>
                <ul className="space-y-1">
                  {selectedFruit.facts.map((fact: string) => (
                    <li
                      key={fact}
                      className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-400"
                    >
                      <span className="mt-0.5 text-blue-600">•</span>
                      {fact}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {hostCapabilities?.message !== undefined && (
                    <button
                      type="button"
                      onClick={() => {
                        void sendFollowUp({
                          prompt: `Tell me more interesting facts about ${selectedFruit.fruit}`,
                        }).catch(() => {});
                      }}
                      className="cursor-pointer rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                    >
                      Ask the AI for more about {selectedFruit.fruit}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      void openExternal({
                        url: `https://images.example.com/producers/${selectedFruit.fruit}`,
                      });
                    }}
                    className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    View producer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Accordion items={accordionItems} />
    </div>
  );
}

export default function ProductSearchResult() {
  return (
    <ThemeProvider>
      <ViewControls>
        <ProductSearchResultContent />
      </ViewControls>
    </ThemeProvider>
  );
}
