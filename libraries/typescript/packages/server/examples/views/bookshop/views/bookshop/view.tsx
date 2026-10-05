import { useEffect, useState } from "react";
import {
  ModelContext,
  useCallTool,
  useDeepLink,
  useDisplayMode,
  useToolContext,
  useViewTheme,
} from "mcp-use/react";
import type { ViewConfig } from "mcp-use/react";
import { parseRoute, pluginLink } from "../../src/route.js";
import "./view.css";

/** Inline cards can expand; entrypoint launch presentation remains host-owned. */
export const viewConfig = {
  displayModes: ["inline", "fullscreen"],
  preferredDisplayMode: "inline",
} satisfies ViewConfig;

type Snapshot = Extract<
  ReturnType<typeof useToolContext<"open_bookshop">>,
  { status: "ready" }
>["toolOutput"];
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function Shop({ initial }: { initial: Snapshot }) {
  const [state, setState] = useState(initial);
  const [route, setRoute] = useState(initial.route);
  const [query, setQuery] = useState("");
  const [pluginId, setPluginId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const theme = useViewTheme();
  const { url } = useDeepLink();
  const { displayMode, availableDisplayModes, requestDisplayMode } =
    useDisplayMode();
  const update = useCallTool("set_cart_item");
  const refresh = useCallTool("read_cart");

  useEffect(() => {
    setState(initial);
    setRoute(initial.route);
  }, [initial]);
  useEffect(() => {
    if (url !== undefined) setRoute(url);
  }, [url]);

  async function change(
    id: "moonlit-atlas" | "small-hours" | "paper-planets",
    quantity: number
  ) {
    setBusy(true);
    setError("");
    try {
      setState((await update.callTool({ id, quantity })).structuredContent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cart update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    setError("");
    try {
      setState((await refresh.callTool({})).structuredContent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMode() {
    setError("");
    try {
      await requestDisplayMode({
        mode: displayMode === "fullscreen" ? "inline" : "fullscreen",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Display request failed."
      );
    }
  }

  const parsed = parseRoute(route);
  const selected =
    parsed.page === "product"
      ? state.books.find((book) => book.id === parsed.id)
      : undefined;
  const filtered = state.books.filter((book) =>
    `${book.title} ${book.author} ${book.genre}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const count = state.cart.reduce((sum, line) => sum + line.quantity, 0);
  const quantity = (id: string) =>
    state.cart.find((line) => line.id === id)?.quantity ?? 0;

  function addButton(id: Snapshot["books"][number]["id"]) {
    return (
      <button
        className="primary"
        disabled={busy || quantity(id) >= 9}
        onClick={() => {
          void change(id, quantity(id) + 1);
        }}
      >
        Add to demo cart
      </button>
    );
  }

  return (
    <main
      className={`bookshop ${theme} ${state.settings.compact ? "compact" : ""}`}
      aria-busy={busy}
    >
      <ModelContext
        content={`Little Bookshop route: ${route}; search: ${query || "all books"}; shared demo cart: ${JSON.stringify(state.cart)}; USD total: ${money(state.totalCents)}. Cart is stored on the server until restart; call read_cart for the latest state.`}
      />
      <header>
        <div>
          <p className="eyebrow">A fictional corner bookshop</p>
          <h1>Little Bookshop</h1>
        </div>
        {availableDisplayModes.includes("fullscreen") && (
          <button
            onClick={() => {
              void toggleMode();
            }}
          >
            {displayMode === "fullscreen" ? "Show inline" : "Expand"}
          </button>
        )}
      </header>
      <nav aria-label="Bookshop">
        <button
          aria-current={parsed.page === "books" ? "page" : undefined}
          onClick={() => setRoute("/books")}
        >
          Browse books
        </button>
        <button
          aria-current={parsed.page === "cart" ? "page" : undefined}
          onClick={() => setRoute("/cart")}
        >
          Demo cart ({count})
        </button>
        <button
          disabled={busy}
          onClick={() => {
            void reload();
          }}
        >
          Refresh
        </button>
      </nav>
      <p className="notice">
        Shared demo cart · resets on server restart · no checkout
      </p>
      {busy && <p role="status">Updating bookshop…</p>}
      {error && <p role="alert">{error}</p>}
      {parsed.page === "books" && (
        <>
          <label className="search">
            Find your next story
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, author, or genre"
            />
          </label>
          <div className="books">
            {filtered.map((book) => (
              <article key={book.id}>
                <button
                  className="cover"
                  style={{ backgroundColor: book.color }}
                  onClick={() => setRoute(`/products/${book.id}`)}
                  aria-label={`Details for ${book.title}`}
                >
                  <span>{book.genre}</span>
                  <strong>{book.title}</strong>
                  <span>{book.author}</span>
                </button>
                <h2>
                  <button
                    className="title"
                    onClick={() => setRoute(`/products/${book.id}`)}
                  >
                    {book.title}
                  </button>
                </h2>
                <p>
                  {book.author} · {money(book.priceCents)}
                </p>
                {state.settings.showDescriptions && <p>{book.description}</p>}
                {addButton(book.id)}
              </article>
            ))}
          </div>
          {!filtered.length && (
            <p>No books match. Try another title or clear your search.</p>
          )}
        </>
      )}
      {selected && (
        <section className="details">
          <p className="eyebrow">{selected.genre}</p>
          <h2>{selected.title}</h2>
          <p>By {selected.author}</p>
          <p>{selected.description}</p>
          <p>
            <strong>{money(selected.priceCents)}</strong> · fictional paperback
          </p>
          {addButton(selected.id)}
          <p>In demo cart: {quantity(selected.id)}</p>
        </section>
      )}
      {parsed.page === "cart" && (
        <section>
          <h2>Your demo cart</h2>
          {!state.cart.length && (
            <p>Your cart is empty. Browse the books to add a story.</p>
          )}
          {state.cart.map((line) => (
            <div className="cart-line" key={line.id}>
              <div>
                <button
                  className="title"
                  onClick={() => setRoute(`/products/${line.id}`)}
                >
                  {line.title}
                </button>
                <p>{money(line.priceCents)} each</p>
              </div>
              <label>
                Quantity
                <select
                  disabled={busy}
                  value={line.quantity}
                  onChange={(event) => {
                    void change(line.id, Number(event.target.value));
                  }}
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <option key={index} value={index}>
                      {index === 0 ? "0 (remove)" : index}
                    </option>
                  ))}
                </select>
              </label>
              <strong>{money(line.quantity * line.priceCents)}</strong>
            </div>
          ))}
          <p className="total">
            Demo total <strong>{money(state.totalCents)}</strong>
          </p>
          <p>No payment, orders, shipping, or checkout.</p>
        </section>
      )}
      {(parsed.page === "missing" ||
        (parsed.page === "product" && !selected)) && (
        <section>
          <h2>Bookshop page not found</h2>
          <p>Use Browse books or Demo cart to continue.</p>
        </section>
      )}
      <footer>
        <p>
          Appearance settings are shared too. After changing native plugin
          settings, press Refresh.
        </p>
        <details>
          <summary>Make a product or cart deep link</summary>
          <label>
            Registered plugin ID
            <input
              value={pluginId}
              onChange={(event) => setPluginId(event.target.value)}
              placeholder="Your installed plugin ID"
            />
          </label>
          {pluginId.trim() && (
            <>
              {["/products/moonlit-atlas", "/cart"].map((path) => (
                <label key={path}>
                  {path}
                  <input
                    readOnly
                    value={pluginLink(pluginId.trim(), path)}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
              ))}
            </>
          )}
          <p>
            Select a link to copy it. Host registration and deep-link support
            are required.
          </p>
        </details>
      </footer>
    </main>
  );
}

/** Render the initial tool result, then keep UI cart changes authoritative on the server. */
export default function BookshopView() {
  const view = useToolContext<"open_bookshop">();
  if (view.status === "pending")
    return (
      <main className="bookshop" role="status">
        Opening Little Bookshop…
      </main>
    );
  if (view.status === "error")
    return (
      <main className="bookshop" role="alert">
        Could not open bookshop: {view.error.message}
      </main>
    );
  return <Shop initial={view.toolOutput} />;
}
