import { MCPServer } from "mcp-use";
import { z } from "zod";
import { books } from "./catalog.js";

const server = new MCPServer({
  name: "little-bookshop",
  title: "Little Bookshop",
  version: "1.0.0",
  description: "Browse fictional books and a shared demo cart. No checkout.",
  legacy: "stateless",
});

// One explicit demo store per server process. Every caller shares it.
// It resets on restart; it is neither account-scoped nor thread-scoped.
const cart = new Map<string, number>();
let preferences = { showDescriptions: true, compact: false };
const bookId = z.enum(["moonlit-atlas", "small-hours", "paper-planets"]);
const snapshotSchema = z.object({
  books: z.array(
    z.object({
      id: bookId,
      title: z.string(),
      author: z.string(),
      genre: z.string(),
      priceCents: z.number().int(),
      description: z.string(),
      color: z.string(),
    })
  ),
  cart: z.array(
    z.object({
      id: bookId,
      title: z.string(),
      quantity: z.number().int(),
      priceCents: z.number().int(),
    })
  ),
  totalCents: z.number().int(),
  settings: z.object({ showDescriptions: z.boolean(), compact: z.boolean() }),
  route: z.string(),
});

function snapshot(route = "/books") {
  const lines = books.flatMap((book) => {
    const quantity = cart.get(book.id) ?? 0;
    return quantity
      ? [
          {
            id: book.id,
            title: book.title,
            quantity,
            priceCents: book.priceCents,
          },
        ]
      : [];
  });
  return {
    books: [...books],
    cart: lines,
    totalCents: lines.reduce(
      (sum, line) => sum + line.quantity * line.priceCents,
      0
    ),
    settings: { ...preferences },
    route,
  };
}

function result(route = "/books") {
  const state = snapshot(route);
  return {
    content: [
      {
        type: "text" as const,
        text: `Shared demo cart: ${state.cart.map((line) => `${line.quantity} × ${line.title}`).join(", ") || "empty"}; total USD ${(state.totalCents / 100).toFixed(2)}. Fictional books; no checkout.`,
      },
    ],
    structuredContent: state,
  };
}

/** Open the store from a model call, global launcher, or conversation tab. */
export const openBookshop = server.tool(
  {
    name: "open_bookshop",
    title: "Little Bookshop",
    description:
      "Browse fictional books. Open /books, /products/moonlit-atlas, /products/small-hours, /products/paper-planets, or /cart. All callers share a process-local demo cart.",
    inputSchema: z.object({ route: z.string().default("/books") }),
    outputSchema: snapshotSchema,
    annotations: { readOnlyHint: true },
    view: {
      name: "bookshop",
      entrypoints: [{ type: "global" }, { type: "thread" }],
    },
  },
  ({ route }) => result(route)
);

/** Read the server's current cart, including changes made through UI buttons. */
export const readCart = server.tool(
  {
    name: "read_cart",
    title: "Read demo cart",
    description:
      "Read the latest shared demo cart and settings. UI changes persist here until the server restarts.",
    inputSchema: z.object({}),
    outputSchema: snapshotSchema,
    annotations: { readOnlyHint: true },
  },
  () => result("/cart")
);

/** Set an absolute quantity; zero removes a line and repeated calls are safe. */
export const setCartItem = server.tool(
  {
    name: "set_cart_item",
    title: "Set demo cart quantity",
    description:
      "Set a fictional book's quantity (0 removes it, maximum 9). Shared demo only; no purchase or payment.",
    inputSchema: z.object({
      id: bookId,
      quantity: z.number().int().min(0).max(9),
    }),
    outputSchema: snapshotSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  ({ id, quantity }) => {
    if (quantity === 0) cart.delete(id);
    else cart.set(id, quantity);
    return result("/cart");
  }
);

server.settings({
  fields: {
    showDescriptions: { schema: z.boolean(), title: "Show book descriptions" },
    compact: { schema: z.boolean(), title: "Compact catalog" },
  },
  layout: [
    {
      kind: "group",
      title: "Bookshop appearance",
      items: [
        { kind: "property", property: "showDescriptions" },
        { kind: "property", property: "compact" },
      ],
    },
  ],
  read: () => ({ ...preferences }),
  update: (set) => {
    preferences = { ...preferences, ...set };
    return { ...preferences };
  },
});

export default server;
