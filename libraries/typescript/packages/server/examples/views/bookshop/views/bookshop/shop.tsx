import { useEffect, useState } from "react";
import {
  useCallTool,
  useDeepLink,
  useDisplayMode,
  useViewTheme,
} from "mcp-use/react";
import type { Book, BookshopData } from "../../src/data.js";
import { navigateTo, parseRoute, routeParams } from "../../src/route.js";
import { ChatContext } from "./attachments.js";
import { BookIcon, Catalog } from "./catalog.js";
import { BookDetails } from "./details.js";
import { Cart, Settings } from "./cart-settings.js";

/** Own the app-local URL and reconcile tool data without resetting navigation. */
export function Shop({ initial }: { initial: BookshopData }) {
  const { url: hostUrl } = useDeepLink();
  const [state, setState] = useState(initial);
  // One app-owned URL. Initial host links win over the default tool route.
  const [route, setRoute] = useState(() => hostUrl ?? initial.route);
  const [pluginId, setPluginId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const theme = useViewTheme();
  const { displayMode, availableDisplayModes, requestDisplayMode } =
    useDisplayMode();
  const update = useCallTool("set_cart_item");
  const refresh = useCallTool("read_cart");
  const settings = useCallTool("update_bookshop_settings");
  useEffect(() => {
    setState(initial);
  }, [initial]);
  useEffect(() => {
    if (hostUrl !== undefined) setRoute(hostUrl);
  }, [hostUrl]);
  function navigate(path: string, patch: Record<string, string | null> = {}) {
    setRoute((current) => navigateTo(current, path, patch));
  }
  async function updateBookshop(
    action: () => Promise<{ structuredContent: BookshopData }>
  ) {
    setBusy(true);
    setError("");
    try {
      setState((await action()).structuredContent);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update bookshop."
      );
    } finally {
      setBusy(false);
    }
  }
  function change(id: Book["id"], quantity: number) {
    void updateBookshop(() => update.callTool({ id, quantity }));
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
  const query = routeParams(route).get("q") ?? "";
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
  const missing =
    parsed.page === "missing" || (parsed.page === "product" && !selected);
  const heading =
    selected?.title ??
    {
      books: "Book library",
      cart: "Demo cart",
      settings: "Settings",
      missing: "Page not found",
      product: "Book not found",
    }[parsed.page];
  return (
    <main
      className={`bookshop ${theme} ${state.settings.compact ? "compact" : ""}`}
    >
      <header className="app-header">
        <div className="brand">
          <BookIcon />
          <span>Little Bookshop</span>
        </div>
        <div className="header-actions">
          <button
            className="quiet"
            aria-current={parsed.page === "settings" ? "page" : undefined}
            onClick={() => navigate("/settings")}
          >
            Settings
          </button>
          {availableDisplayModes.includes(
            displayMode === "fullscreen" ? "inline" : "fullscreen"
          ) && (
            <button
              onClick={() => {
                void toggleMode();
              }}
            >
              {displayMode === "fullscreen" ? "Show inline" : "Expand"}
            </button>
          )}
        </div>
      </header>
      <nav className="toolbar" aria-label="Bookshop">
        <button
          aria-current={parsed.page === "books" ? "page" : undefined}
          onClick={() => navigate("/books")}
        >
          Library
        </button>
        <button
          aria-current={parsed.page === "cart" ? "page" : undefined}
          onClick={() => navigate("/cart")}
        >
          Demo cart <span className="badge">{count}</span>
        </button>
        <button
          className="quiet refresh"
          disabled={busy}
          onClick={() => {
            void updateBookshop(() => refresh.callTool({}));
          }}
        >
          {busy ? "Updating…" : "Refresh"}
        </button>
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="page-heading">
        <h1>{heading}</h1>
        {parsed.page === "books" && (
          <span className="muted">
            {filtered.length} {filtered.length === 1 ? "book" : "books"}
          </span>
        )}
      </div>
      {parsed.page === "books" && (
        <Catalog
          filtered={filtered}
          query={query}
          showDescriptions={state.settings.showDescriptions}
          busy={busy}
          quantity={quantity}
          onChangeQuantity={change}
          navigate={navigate}
        />
      )}
      {selected && (
        <BookDetails
          book={selected}
          quantity={quantity(selected.id)}
          busy={busy}
          onChangeQuantity={change}
        />
      )}
      {parsed.page === "cart" && (
        <Cart
          data={state}
          busy={busy}
          navigate={navigate}
          onChangeQuantity={change}
        />
      )}
      {parsed.page === "settings" && (
        <Settings
          pluginId={pluginId}
          onChangePluginId={setPluginId}
          settings={state.settings}
          busy={busy}
          onChangeSettings={(preferences) => {
            void updateBookshop(() => settings.callTool(preferences));
          }}
        />
      )}
      {missing && (
        <section className="empty">
          <h2>That page isn’t on the shelf</h2>
          <p>Browse the library to find your next story.</p>
          <button onClick={() => navigate("/books")}>Browse books</button>
        </section>
      )}
      <ChatContext />
      <footer>
        <span>
          Fictional books · shared demo cart & settings · reset on restart
        </span>
        <span>USD</span>
      </footer>
    </main>
  );
}
