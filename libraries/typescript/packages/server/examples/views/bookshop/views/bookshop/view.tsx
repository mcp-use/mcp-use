import { useEffect, useState } from "react";
import {
  getPublicBaseUrl,
  Image,
  useCallTool,
  useDeepLink,
  useDisplayMode,
  useToolContext,
  useViewTheme,
} from "mcp-use/react";
import type { ViewConfig } from "mcp-use/react";
import {
  navigateTo,
  parseRoute,
  pluginLink,
  routeParams,
} from "../../src/route.js";
import { AttachButton, ChatContext, coverContent } from "./attachments.js";
import "./view.css";

/** Inline cards can expand; explicit attachments use the shared context coordinator. */
export const viewConfig = {
  displayModes: ["inline", "fullscreen"],
  preferredDisplayMode: "inline",
  modelContext: "attachments",
} satisfies ViewConfig;

type Snapshot = Extract<
  ReturnType<typeof useToolContext<"open_bookshop">>,
  { status: "ready" }
>["toolOutput"];
type Book = Snapshot["books"][number];
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
function BookIcon() {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15" />
    </svg>
  );
}
function Shop({ initial }: { initial: Snapshot }) {
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
  async function updateSnapshot(
    action: () => Promise<{ structuredContent: Snapshot }>
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
    void updateSnapshot(() => update.callTool({ id, quantity }));
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
  function cartButton(book: Book) {
    return (
      <button
        className="primary"
        disabled={busy || quantity(book.id) >= 9}
        onClick={() => change(book.id, quantity(book.id) + 1)}
      >
        {quantity(book.id) >= 9 ? "Cart limit reached" : "Add to cart"}
      </button>
    );
  }
  function chatButton(book: Book) {
    return (
      <AttachButton
        key={`bookshop:cover:${book.id}`}
        attachmentKey={`bookshop:cover:${book.id}`}
        label="Add to chat"
        content={() => coverContent(book.cover, book.title)}
      />
    );
  }
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
            void updateSnapshot(() => refresh.callTool({}));
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
        <>
          <p className="muted intro">
            Small stories. Other worlds. A fictional collection to explore.
          </p>
          <input
            className="search"
            type="search"
            aria-label="Search books"
            value={query}
            onChange={(event) =>
              navigate("/books", { q: event.target.value || null })
            }
            placeholder="Search title, author, or genre…"
          />
          <div className="books">
            {filtered.map((book) => (
              <article className="book-card" key={book.id}>
                <button
                  className="cover-preview"
                  onClick={() => navigate(`/products/${book.id}`)}
                  aria-label={`Details for ${book.title}`}
                >
                  <Image src={`/${book.cover}`} alt={`${book.title} cover`} />
                </button>
                <div className="card-content">
                  <div className="book-meta">
                    <span>{book.genre}</span>
                    <span>{money(book.priceCents)}</span>
                  </div>
                  <h2>
                    <button
                      className="title"
                      onClick={() => navigate(`/products/${book.id}`)}
                    >
                      {book.title}
                    </button>
                  </h2>
                  <p className="author">{book.author}</p>
                  {state.settings.showDescriptions && (
                    <p className="description">{book.description}</p>
                  )}
                  <div className="card-actions">
                    {cartButton(book)}
                    {chatButton(book)}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <section className="empty">
              <BookIcon />
              <h2>No books found</h2>
              <p>Try another title, author, or genre.</p>
              <button onClick={() => navigate("/books", { q: null })}>
                Clear search
              </button>
            </section>
          )}
        </>
      )}
      {selected && (
        <section className="details-grid">
          <div className="detail-cover">
            <Image src={`/${selected.cover}`} alt={`${selected.title} cover`} />
          </div>
          <div className="detail-panel">
            <div className="book-meta">
              <span>{selected.genre}</span>
              <span>Fictional paperback</span>
            </div>
            <h2>{selected.title}</h2>
            <p className="author">By {selected.author}</p>
            <p className="description">{selected.description}</p>
            <div className="price-row">
              <strong>{money(selected.priceCents)}</strong>
              <span className="muted">
                {quantity(selected.id)} in demo cart
              </span>
            </div>
            <div className="card-actions">
              {cartButton(selected)}
              {chatButton(selected)}
            </div>
            <p className="muted">
              Add to chat shares the illustrated cover. Your cart stays
              separate.
            </p>
            <div className="sample">
              <h3>A few opening lines</h3>
              <blockquote>{selected.excerpt}</blockquote>
              <div className="card-actions">
                <AttachButton
                  key={`bookshop:details:${selected.id}`}
                  attachmentKey={`bookshop:details:${selected.id}`}
                  label="Add book details"
                  content={() => ({
                    type: "text",
                    title: selected.title,
                    thumbnail: {
                      src: `${getPublicBaseUrl()}${selected.cover}`,
                      mimeType: "image/png",
                    },
                    text: `${selected.title} by ${selected.author}. ${selected.genre}. Fictional paperback, USD ${money(selected.priceCents)}. ${selected.description}`,
                  })}
                />
                <AttachButton
                  key={`bookshop:sample:${selected.id}`}
                  attachmentKey={`bookshop:sample:${selected.id}`}
                  label="Add reading sample"
                  content={() => ({
                    type: "resource",
                    resource: {
                      uri: `bookshop://books/${selected.id}/sample`,
                      mimeType: "text/plain",
                      text: `${selected.title} — fictional reading sample\n\n${selected.excerpt}`,
                    },
                  })}
                />
              </div>
            </div>
          </div>
        </section>
      )}
      {parsed.page === "cart" && (
        <section className="cart-panel">
          {!state.cart.length ? (
            <div className="empty">
              <BookIcon />
              <h2>A story belongs here</h2>
              <p>Your demo cart is empty.</p>
              <button onClick={() => navigate("/books")}>Browse books</button>
            </div>
          ) : (
            <>
              {state.cart.map((line) => {
                const book = state.books.find((item) => item.id === line.id);
                return (
                  <div className="cart-line" key={line.id}>
                    {book && (
                      <button
                        className="cart-cover"
                        onClick={() => navigate(`/products/${line.id}`)}
                        aria-label={`Details for ${line.title}`}
                      >
                        <Image src={`/${book.cover}`} alt="" />
                      </button>
                    )}
                    <div className="cart-book">
                      <h2>
                        <button
                          className="title"
                          onClick={() => navigate(`/products/${line.id}`)}
                        >
                          {line.title}
                        </button>
                      </h2>
                      <p className="muted">{money(line.priceCents)} each</p>
                    </div>
                    <label className="quantity">
                      Quantity
                      <select
                        aria-label={`Quantity for ${line.title}`}
                        disabled={busy}
                        value={line.quantity}
                        onChange={(event) =>
                          change(line.id, Number(event.target.value))
                        }
                      >
                        {Array.from({ length: 10 }, (_, index) => (
                          <option key={index} value={index}>
                            {index === 0 ? "Remove" : index}
                          </option>
                        ))}
                      </select>
                    </label>
                    <strong>{money(line.quantity * line.priceCents)}</strong>
                  </div>
                );
              })}
              <div className="total">
                <span>Demo total</span>
                <strong>{money(state.totalCents)}</strong>
              </div>
            </>
          )}
          <p className="muted">
            A shared demo cart. No payments, orders, or checkout.
          </p>
        </section>
      )}
      {parsed.page === "settings" && (
        <section className="settings-panel">
          <p className="muted">
            Appearance preferences apply to everyone using this demo server.
          </p>
          <label>
            <span>
              <strong>Book descriptions</strong>
              <small>Show a short synopsis on library cards.</small>
            </span>
            <input
              type="checkbox"
              checked={state.settings.showDescriptions}
              disabled={busy}
              onChange={(event) => {
                void updateSnapshot(() =>
                  settings.callTool({
                    ...state.settings,
                    showDescriptions: event.target.checked,
                  })
                );
              }}
            />
          </label>
          <label>
            <span>
              <strong>Compact library</strong>
              <small>Use smaller cover previews.</small>
            </span>
            <input
              type="checkbox"
              checked={state.settings.compact}
              disabled={busy}
              onChange={(event) => {
                void updateSnapshot(() =>
                  settings.callTool({
                    ...state.settings,
                    compact: event.target.checked,
                  })
                );
              }}
            />
          </label>
          <p className="muted">
            These are the same preferences as native plugin settings. Refresh
            after changes from another view.
          </p>
          <details className="link-helper">
            <summary>Make a deep link</summary>
            <label>
              Registered plugin ID
              <input
                value={pluginId}
                onChange={(event) => setPluginId(event.target.value)}
                placeholder="Your installed plugin ID"
              />
            </label>
            {pluginId.trim() &&
              [
                "/books?q=moon",
                "/products/moonlit-atlas",
                "/cart",
                "/settings",
              ].map((path) => (
                <label key={path}>
                  {path}
                  <input
                    readOnly
                    value={pluginLink(pluginId.trim(), path)}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
              ))}
            <p className="muted">
              Select a generated link to copy it. Requires host registration and
              deep-link support.
            </p>
          </details>
        </section>
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
/** Mount navigation after tool data is ready; later snapshots do not reset it. */
export default function BookshopView() {
  const view = useToolContext<"open_bookshop">();
  if (view.status === "pending")
    return (
      <main className="bookshop empty" role="status">
        Opening Little Bookshop…
      </main>
    );
  if (view.status === "error")
    return (
      <main className="bookshop empty" role="alert">
        Could not open bookshop: {view.error.message}
      </main>
    );
  return <Shop initial={view.toolOutput} />;
}
