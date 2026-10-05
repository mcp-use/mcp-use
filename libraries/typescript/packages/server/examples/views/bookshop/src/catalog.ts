/** Fictional books; prices are integer USD cents, with no payment flow. */
export const books = [
  {
    id: "moonlit-atlas",
    title: "The Moonlit Atlas",
    author: "Mira Vale",
    genre: "Adventure",
    priceCents: 1800,
    description: "A mapmaker follows a wandering island across a sea of stars.",
    color: "#304d64",
  },
  {
    id: "small-hours",
    title: "Small Hours, Big Gardens",
    author: "Rowan Finch",
    genre: "Cozy fiction",
    priceCents: 1400,
    description: "Neighbors turn an abandoned railway into a midnight garden.",
    color: "#57705c",
  },
  {
    id: "paper-planets",
    title: "Paper Planets",
    author: "Ellis Wren",
    genre: "Science fiction",
    priceCents: 2200,
    description:
      "An archivist discovers a universe folded between library pages.",
    color: "#875a49",
  },
] as const;
