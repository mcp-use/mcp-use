# Little Bookshop — ChatGPT Plugin Extensions

Three fictional books, browsing and details, and a demo cart. No credentials,
external services, payments, orders, or checkout.

## Run from this checkout

This example uses the unpublished APIs in the current PR stack. Use the workspace
packages, rather than an older npm release. From `libraries/typescript`:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter mcp-use-example-bookshop dev --port 3217 --host 127.0.0.1
```

Open `http://127.0.0.1:3217/inspector` and connect to
`http://127.0.0.1:3217/mcp`. Call `open_bookshop` with `{}` to render the view.
The local Inspector can exercise the UI and bridge. Native launchers and
settings require installation in a supporting ChatGPT host; this example does
not deploy the server or create a tunnel.

Production and verification commands, also from `libraries/typescript`:

```sh
pnpm --filter mcp-use-example-bookshop build
pnpm --filter mcp-use-example-bookshop typecheck
pnpm --filter mcp-use-example-bookshop start --port 3217 --host 127.0.0.1
```

## Feature map

| Feature                         | Where to look                                                      |
| ------------------------------- | ------------------------------------------------------------------ |
| Global and thread launchers     | `src/index.ts`: `open_bookshop.view.entrypoints`; both accept `{}` |
| Browse, search, product details | `views/bookshop/view.tsx`; fictional catalog in `src/catalog.ts`   |
| Server cart and typed UI calls  | `set_cart_item`, `read_cart`, `useCallTool`                        |
| Inline/fullscreen               | Static `viewConfig` and capability-aware `useDisplayMode` button   |
| Product/cart deep links         | `useDeepLink`, allowlisted routes in `src/route.ts`                |
| Simple native settings          | `server.settings`: descriptions and compact catalog                |
| Model-visible UI summary        | `ModelContext`; `read_cart` supplies authoritative server state    |

## State and scope

There is **one shared demo cart and one shared preferences object per server
process**. All model tools, UI instances, connections, global launches, and thread
launches read the same store. Values survive closing a view or opening another
connection, but reset when the server restarts. There is no account or thread
isolation and no durable database. This explicit demo scope avoids inventing a
conversation-ID API. Never put private user data in this shared store.

An Add button calls `set_cart_item` and displays the returned server snapshot;
it does not keep a separate browser cart. Quantity updates are absolute and
idempotent; zero removes a book. Updates run synchronously on this single process.
Concurrent callers use last-write-wins. Press Refresh after another UI/model
changes the cart or native settings. Independent mounted views are snapshots;
there is no automatic cross-view push. Local routing/search is ephemeral, and
`ModelContext` shares what the current view displays. For production, add verified
authorization and an atomic store scoped to that identity.

## Deep links

Supported app routes are `/books`, `/products/moonlit-atlas`,
`/products/small-hours`, `/products/paper-planets`, and `/cart`. Unknown products
and malformed or external URLs show a recoverable missing-page screen.

Enter your **registered plugin ID** in the view's deep-link helper. It constructs:

```text
https://chatgpt.com/plugins/<encoded-plugin-id>/app/open_bookshop?path=%2Fcart
https://chatgpt.com/plugins/<encoded-plugin-id>/app/open_bookshop?path=%2Fproducts%2Fmoonlit-atlas
```

These links need a registered, installed plugin and a supporting host. Incoming
links update the local route; ordinary navigation does not set the host URL.
Before registration, exercise the same screen by calling `open_bookshop` with
`{"route":"/cart"}` or `{"route":"/products/moonlit-atlas"}`. That proves rendering,
not native deep-link delivery. Global/thread launchers are fullscreen in supporting
hosts; ordinary tool cards prefer inline. Hosts may ignore presentation requests.

## Try these prompts

- “Open Little Bookshop.”
- “Show me Paper Planets.” (`open_bookshop`, route `/products/paper-planets`)
- “Add two copies of The Moonlit Atlas to the demo cart.”
- Click Add in the UI, then ask “What's in the demo cart now?” (`read_cart`)
- “Remove Paper Planets from the demo cart.” (quantity `0`)
- “Use a compact catalog and hide descriptions.” (`settings.update`)

## Verification boundaries

Build and typecheck commands verify the example's packaging and static types.
Use the Inspector to check the UI, button-to-tool calls, current cart state,
routing, settings refresh, appearance, and sizing in your host.
Native ChatGPT launcher placement, native settings controls, and registered
plugin-link delivery require separate verification in a supporting host.
