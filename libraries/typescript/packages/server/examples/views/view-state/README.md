# View state store

A deliberately small ecommerce example for `useViewState` and `ModelContext`.

- The carousel index uses React `useState`.
- The cart uses `useViewState`, so the model receives its structured contents.
- One `ModelContext` describes the product currently visible in the carousel.

Run `pnpm dev`, then call the `open-store` tool.
