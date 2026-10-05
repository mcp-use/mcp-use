import { useEffect, useState } from "react";
import { useCallTool, useDisplayMode, useViewTheme } from "mcp-use/react";
import type { Book, BookshopData } from "../../src/data.js";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { MissingPage } from "./routing.js";
import { ChatContext } from "./attachments.js";
import { BookIcon, Catalog } from "./catalog.js";
import { BookDetails } from "./details.js";
import { Cart, Settings } from "./cart-settings.js";

/** Compose routed screens and reconcile tool data without resetting navigation. */
export function Shop({ initial }: { initial: BookshopData }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [state, setState] = useState(initial);
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
  const count = state.cart.reduce((sum, line) => sum + line.quantity, 0);
  const quantity = (id: string) =>
    state.cart.find((line) => line.id === id)?.quantity ?? 0;
  const catalog = (
    <Catalog
      books={state.books}
      showDescriptions={state.settings.showDescriptions}
      busy={busy}
      quantity={quantity}
      onChangeQuantity={change}
    />
  );
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
            aria-current={pathname === "/settings" ? "page" : undefined}
            onClick={() => navigate({ pathname: "/settings", search })}
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
          aria-current={
            pathname === "/" || pathname === "/books" ? "page" : undefined
          }
          onClick={() => navigate({ pathname: "/books", search })}
        >
          Library
        </button>
        <button
          aria-current={pathname === "/cart" ? "page" : undefined}
          onClick={() => navigate({ pathname: "/cart", search })}
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
      <Routes>
        <Route path="/" element={catalog} />
        <Route path="/books" element={catalog} />
        <Route
          path="/products/:id"
          element={
            <BookDetails
              books={state.books}
              quantity={quantity}
              busy={busy}
              onChangeQuantity={change}
            />
          }
        />
        <Route
          path="/cart"
          element={<Cart data={state} busy={busy} onChangeQuantity={change} />}
        />
        <Route
          path="/settings"
          element={
            <Settings
              pluginId={pluginId}
              onChangePluginId={setPluginId}
              settings={state.settings}
              busy={busy}
              onChangeSettings={(preferences) => {
                void updateBookshop(() => settings.callTool(preferences));
              }}
            />
          }
        />
        <Route path="*" element={<MissingPage />} />
      </Routes>
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
