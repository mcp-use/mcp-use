import { z } from "zod";

/** The three stable IDs accepted by Bookshop tools. */
export const bookId = z.enum(["moonlit-atlas", "small-hours", "paper-planets"]);
/** Shared tool output contract for the server and Bookshop UI. */
export const bookshopSchema = z.object({
  books: z.array(
    z.object({
      id: bookId,
      title: z.string(),
      author: z.string(),
      genre: z.string(),
      priceCents: z.number().int(),
      description: z.string(),
      cover: z.string(),
      excerpt: z.string(),
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

/** Current catalog, demo cart, preferences, and initial route. */
export type BookshopData = z.infer<typeof bookshopSchema>;

/** A catalog entry from the shared tool output contract. */
export type Book = BookshopData["books"][number];

/** Appearance preferences shared by native and in-app settings. */
export type BookshopSettings = BookshopData["settings"];
