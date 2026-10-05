/** Fictional books; prices are integer USD cents, with no payment flow. */
export const books = [
  {
    id: "moonlit-atlas",
    title: "The Moonlit Atlas",
    author: "Mira Vale",
    genre: "Adventure",
    priceCents: 1800,
    description: "A mapmaker follows a wandering island across a sea of stars.",
    cover: "covers/moonlit-atlas.png",
    excerpt:
      "The island had moved again. By dawn, Ada’s careful ink lines described a coastline that no longer existed. She folded the map, watched a silver trail vanish into the harbor, and set out to ask the moon for directions.",
  },
  {
    id: "small-hours",
    title: "Small Hours, Big Gardens",
    author: "Rowan Finch",
    genre: "Cozy fiction",
    priceCents: 1400,
    description: "Neighbors turn an abandoned railway into a midnight garden.",
    cover: "covers/small-hours.png",
    excerpt:
      "At eleven minutes past midnight, the first tomato appeared on the platform. Nobody admitted planting it. By Friday, the old station clock had become a trellis, and the neighbors had begun arriving with watering cans instead of suitcases.",
  },
  {
    id: "paper-planets",
    title: "Paper Planets",
    author: "Ellis Wren",
    genre: "Science fiction",
    priceCents: 2200,
    description:
      "An archivist discovers a universe folded between library pages.",
    cover: "covers/paper-planets.png",
    excerpt:
      "Every book in the archive weighed precisely what it should, except the blue one. It was getting lighter. When Jun opened it, a tiny paper moon slipped from the index and began to orbit the reading lamp.",
  },
] as const;
