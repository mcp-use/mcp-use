import { Image, useModelContext, type ModelContextBlock } from "mcp-use/react";
import { useParams } from "react-router";
import { MissingPage } from "./routing.js";
import type { Book } from "../../src/data.js";
import { AttachButton } from "./attachments.js";
import { BookActions, money } from "./catalog.js";

interface DetailsProps {
  books: Book[];
  quantity: (id: Book["id"]) => number;
  busy: boolean;
  onChangeQuantity: (id: Book["id"], quantity: number) => void;
}

/** A book's cover, synopsis, and explicitly attachable reading sample. */
export function BookDetails({
  books,
  quantity,
  busy,
  onChangeQuantity,
}: DetailsProps) {
  const { add } = useModelContext();
  const { id } = useParams();
  const book = books.find((book) => book.id === id);
  if (!book) return <MissingPage title="Book not found" />;
  const details: ModelContextBlock = {
    type: "text",
    title: book.title,
    thumbnail: {
      src: `/${book.cover}`,
      mimeType: "image/png",
    },
    text: `${book.title} by ${book.author}. ${book.genre}. Fictional paperback, USD ${money(book.priceCents)}. ${book.description}`,
  };
  const sample: ModelContextBlock = {
    type: "resource",
    title: `${book.title} — reading sample`,
    resource: {
      uri: `bookshop://books/${book.id}/sample`,
      mimeType: "text/plain",
      text: `${book.title} — fictional reading sample\n\n${book.excerpt}`,
    },
  };
  return (
    <>
      <div className="page-heading">
        <h1>{book.title}</h1>
      </div>
      <section className="details-grid">
        <div className="detail-cover">
          <Image src={`/${book.cover}`} alt={`${book.title} cover`} />
        </div>
        <div className="detail-panel">
          <div className="book-meta">
            <span>{book.genre}</span>
            <span>Fictional paperback</span>
          </div>
          <h2>{book.title}</h2>
          <p className="author">By {book.author}</p>
          <p className="description">{book.description}</p>
          <div className="price-row">
            <strong>{money(book.priceCents)}</strong>
            <span className="muted">{quantity(book.id)} in demo cart</span>
          </div>
          <div className="card-actions">
            <BookActions
              book={book}
              quantity={quantity(book.id)}
              busy={busy}
              onChangeQuantity={onChangeQuantity}
            />
          </div>
          <p className="muted">
            Add to chat shares the illustrated cover. Your cart stays separate.
          </p>
          <div className="sample">
            <h3>A few opening lines</h3>
            <blockquote>{book.excerpt}</blockquote>
            <div className="card-actions">
              <AttachButton
                key={`bookshop:details:${book.id}`}
                label="Add book details"
                onAttach={() => add(`bookshop:details:${book.id}`, details)}
              />
              <AttachButton
                key={`bookshop:sample:${book.id}`}
                label="Add reading sample"
                onAttach={() => add(`bookshop:sample:${book.id}`, sample)}
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
