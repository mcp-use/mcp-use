import {
  getPublicBaseUrl,
  Image,
  imageFromUrl,
  useModelContext,
} from "mcp-use/react";
import type { Book } from "../../src/data.js";
import { AttachButton } from "./attachments.js";

interface BookActionsProps {
  book: Book;
  quantity: number;
  busy: boolean;
  onChangeQuantity: (id: Book["id"], quantity: number) => void;
}
interface CatalogProps {
  filtered: Book[];
  query: string;
  showDescriptions: boolean;
  busy: boolean;
  quantity: (id: Book["id"]) => number;
  onChangeQuantity: BookActionsProps["onChangeQuantity"];
  navigate: (path: string, patch?: Record<string, string | null>) => void;
}
/** Format the integer USD cents used throughout this demo. */
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** Monochrome Bookshop mark shared by the header and empty states. */
export function BookIcon() {
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
/** Shopping and composer actions stay explicit and independent. */
export function BookActions({
  book,
  quantity,
  busy,
  onChangeQuantity,
}: BookActionsProps) {
  const { add } = useModelContext();
  return (
    <>
      <button
        className="primary"
        disabled={busy || quantity >= 9}
        onClick={() => onChangeQuantity(book.id, quantity + 1)}
      >
        {quantity >= 9 ? "Cart limit reached" : "Add to cart"}
      </button>
      <AttachButton
        key={`bookshop:cover:${book.id}`}
        label="Add to chat"
        onAttach={async () =>
          add(
            `bookshop:cover:${book.id}`,
            await imageFromUrl(`${getPublicBaseUrl()}${book.cover}`, {
              title: `${book.title} — cover`,
            })
          )
        }
      />
    </>
  );
}

/** Searchable catalog with independent cart and chat actions. */
export function Catalog({
  filtered,
  query,
  showDescriptions,
  busy,
  quantity,
  onChangeQuantity,
  navigate,
}: CatalogProps) {
  return (
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
              {showDescriptions && (
                <p className="description">{book.description}</p>
              )}
              <div className="card-actions">
                <BookActions
                  book={book}
                  quantity={quantity(book.id)}
                  busy={busy}
                  onChangeQuantity={onChangeQuantity}
                />
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
  );
}
