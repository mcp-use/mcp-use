import { useLocation, useNavigate } from "react-router";
import { Image } from "mcp-use/react";
import type { Book, BookshopData, BookshopSettings } from "../../src/data.js";
import { pluginLink } from "../../src/route.js";
import { BookIcon, money } from "./catalog.js";

interface CartProps {
  data: BookshopData;
  busy: boolean;
  onChangeQuantity: (id: Book["id"], quantity: number) => void;
}
interface SettingsProps {
  settings: BookshopSettings;
  busy: boolean;
  onChangeSettings: (settings: BookshopSettings) => void;
  pluginId: string;
  onChangePluginId: (pluginId: string) => void;
}

/** Shared demo cart; changing quantities does not attach model context. */
export function Cart({ data, busy, onChangeQuantity }: CartProps) {
  const navigate = useNavigate();
  const { search } = useLocation();
  return (
    <>
      <div className="page-heading">
        <h1>Demo cart</h1>
      </div>
      <section className="cart-panel">
        {!data.cart.length ? (
          <div className="empty">
            <BookIcon />
            <h2>A story belongs here</h2>
            <p>Your demo cart is empty.</p>
            <button onClick={() => navigate({ pathname: "/books", search })}>
              Browse books
            </button>
          </div>
        ) : (
          <>
            {data.cart.map((line) => {
              const book = data.books.find((item) => item.id === line.id);
              return (
                <div className="cart-line" key={line.id}>
                  {book && (
                    <button
                      className="cart-cover"
                      onClick={() =>
                        navigate({ pathname: `/products/${line.id}`, search })
                      }
                      aria-label={`Details for ${line.title}`}
                    >
                      <Image src={`/${book.cover}`} alt="" />
                    </button>
                  )}
                  <div className="cart-book">
                    <h2>
                      <button
                        className="title"
                        onClick={() =>
                          navigate({ pathname: `/products/${line.id}`, search })
                        }
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
                        onChangeQuantity(line.id, Number(event.target.value))
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
              <strong>{money(data.totalCents)}</strong>
            </div>
          </>
        )}
        <p className="muted">
          A shared demo cart. No payments, orders, or checkout.
        </p>
      </section>
    </>
  );
}

/** In-app preferences and the optional registered-plugin link helper. */
export function Settings({
  settings,
  busy,
  onChangeSettings,
  pluginId,
  onChangePluginId,
}: SettingsProps) {
  return (
    <>
      <div className="page-heading">
        <h1>Settings</h1>
      </div>
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
            checked={settings.showDescriptions}
            disabled={busy}
            onChange={(event) => {
              onChangeSettings({
                ...settings,
                showDescriptions: event.target.checked,
              });
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
            checked={settings.compact}
            disabled={busy}
            onChange={(event) => {
              onChangeSettings({
                ...settings,
                compact: event.target.checked,
              });
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
              onChange={(event) => onChangePluginId(event.target.value)}
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
    </>
  );
}
