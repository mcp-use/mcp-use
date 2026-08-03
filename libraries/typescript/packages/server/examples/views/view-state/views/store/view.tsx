import { useState } from "react";
import {
  ModelContext,
  ThemeProvider,
  useToolContext,
  useViewState,
} from "mcp-use/react";

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  emoji: string;
};

type CartState = {
  cart: Array<{
    id: string;
    name: string;
    price: number;
  }>;
};

function Store() {
  const view = useToolContext<"open-store">();
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewState, setViewState] = useViewState<CartState>({ cart: [] });

  if (view.status === "pending") {
    return <div className="p-6">Opening store…</div>;
  }

  if (view.status === "error") {
    return <div className="p-6 text-red-600">{view.error.message}</div>;
  }

  const products: Product[] = view.toolOutput.products;
  const product = products[activeIndex];

  if (!product) {
    return <div className="p-6">No products available.</div>;
  }

  function showPrevious() {
    setActiveIndex((current) =>
      current === 0 ? products.length - 1 : current - 1
    );
  }

  function showNext() {
    setActiveIndex((current) => (current + 1) % products.length);
  }

  return (
    <ModelContext
      content={`Shopping carousel currently showing ${product.name} for $${product.price}.`}
    >
      <main className="mx-auto max-w-md space-y-4 p-6 font-sans text-neutral-900 dark:text-neutral-100">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Simple Store</h1>
          <span className="text-sm">Cart: {viewState.cart.length}</span>
        </header>

        <section className="rounded-xl border border-neutral-200 p-6 text-center dark:border-neutral-700">
          <div className="mb-3 text-7xl" aria-hidden="true">
            {product.emoji}
          </div>
          <h2 className="text-lg font-semibold">{product.name}</h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {product.description}
          </p>
          <p className="mt-3 text-lg font-medium">${product.price}</p>

          <div className="mt-5 flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-600"
              onClick={showPrevious}
              aria-label="Previous product"
            >
              ←
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-600 px-4 py-2 text-white"
              onClick={() =>
                setViewState((previous) => ({
                  cart: [
                    ...previous.cart,
                    {
                      id: product.id,
                      name: product.name,
                      price: product.price,
                    },
                  ],
                }))
              }
            >
              Add to cart
            </button>
            <button
              type="button"
              className="rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-600"
              onClick={showNext}
              aria-label="Next product"
            >
              →
            </button>
          </div>
        </section>

        {viewState.cart.length > 0 && (
          <section>
            <h2 className="font-medium">Your cart</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {viewState.cart.map((item, index) => (
                <li key={`${item.id}-${index}`}>
                  {item.name} — ${item.price}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </ModelContext>
  );
}

export default function StoreView() {
  return (
    <ThemeProvider>
      <Store />
    </ThemeProvider>
  );
}
