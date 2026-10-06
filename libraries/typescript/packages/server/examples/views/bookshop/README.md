# Little Bookshop — ChatGPT Plugin Extensions

Three fictional books, illustrated covers, a library, reading samples, and a demo
cart. No credentials, external services, payments, orders, or checkout.

## Run from this checkout

This example uses the unpublished APIs in the current PR stack, including
`useModelContext`. Use workspace packages rather than an older npm release.
From `libraries/typescript`:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter mcp-use-example-bookshop dev --port 3217 --host 127.0.0.1
```

Open `http://127.0.0.1:3217/inspector` and connect to
`http://127.0.0.1:3217/mcp`. Call `open_bookshop` with `{}` to render the view.
Native launchers and settings require installation in a supporting host. This
example does not deploy a server or create a tunnel.

Production and static verification commands, from `libraries/typescript`:

```sh
pnpm --filter mcp-use-example-bookshop build
pnpm --filter mcp-use-example-bookshop typecheck
pnpm exec eslint packages/server/examples/views/bookshop --max-warnings 0
pnpm exec prettier --check packages/server/examples/views/bookshop
pnpm --filter mcp-use-example-bookshop start --port 3217 --host 127.0.0.1
```

## Design and feature map

The compact header, 19px screen title, 14px system type, 8px controls, 10px card
spacing, and host theme variables follow the
[Bits & Bolts reference at ca16cb3](https://github.com/openai/mcp-extensions/tree/ca16cb3bc015baaa1b849082d8755bbef18770cb/plugins/bits-and-bolts).
Book covers replace its geometry previews. The three illustrations and excerpts
are original fictional demo content. The PNG covers live under `public/covers`;
no remote image service is required. Public URLs use
the request-resolved asset base. `open_bookshop.icons` advertises `public/book.svg`
on `tools/list` for its global and thread entrypoints. The SVG uses a transparent
20×20 viewport, `currentColor`, and a 1.33px stroke for light and dark themes.
The Bookshop server constructor does not set an icon; this artwork belongs to the
entrypoint tool. Launch locations remain separate in `view.entrypoints`.

Start with `src/index.ts` for the server and `views/bookshop/view.tsx` for the UI.
The view entry only declares display modes and handles loading/error states. Its
ready branch mounts `BookshopRouter` and `Shop`; the screen components receive
domain data and callbacks and read their route parameters with React Router.
`src/data.ts` defines the output schema and infers `BookshopData`, `Book`, and
`BookshopSettings`, so the server and UI share one data contract.

| Feature                                          | Where to look                                        |
| ------------------------------------------------ | ---------------------------------------------------- |
| Global/thread launchers, tools, native settings  | `src/index.ts`                                       |
| Output schema and domain types                   | `src/data.ts`; fictional catalog in `src/catalog.ts` |
| View configuration and loading/error states      | `views/bookshop/view.tsx`                            |
| Tool calls, routes, header, inline/fullscreen    | `views/bookshop/shop.tsx`                            |
| Memory history and incoming host-link adapter    | `views/bookshop/routing.tsx`                         |
| Library, search, shared book controls            | `views/bookshop/catalog.tsx`                         |
| Book details and typed text/resource attachments | `views/bookshop/details.tsx`                         |
| Demo cart and appearance settings                | `views/bookshop/cart-settings.tsx`                   |
| Attachment feedback, list, remove, clear         | `views/bookshop/attachments.tsx`                     |

## Cart, settings, and chat context

**Add to cart** calls `set_cart_item`. There is one shared demo cart and one shared
preferences object per server process. All tools, UI instances, global launches,
and thread launches read that store. Values reset on restart. There is no account
or thread isolation, database, or purchase flow. Never put private user data here.

Quantities are absolute and idempotent; zero removes a book and nine is the limit.
Concurrent callers use last-write-wins. Refresh after another view/model changes
cart or native settings. Mounted views hold snapshots, with no cross-view push.
The in-app settings controls update the same preferences as native settings.
Each control sends only its changed field, preserving other preferences changed
by another view since this view's last refresh.

**Add to chat** calls `add(key, { type: "image", src: "/covers/...", title })`.
Like the SDK's `Image` component, image blocks resolve public paths against the request's asset base; the SDK fetches,
validates, and converts the PNG bytes internally. Product details
also offer **Add book details**, a text block with a friendly title and cover
thumbnail using the same public path, and **Add reading sample**, an embedded
plain-text resource containing the displayed excerpt. Stable keys update the same item without duplicating it.
Cart updates, browsing, and settings changes never attach anything automatically.
The example does not duplicate removable evidence in background model context.
`read_cart` remains the authoritative way for the model to inspect shopping state.

The catalog and details components call `add(stableKey, block)` explicitly.
Image fetch or conversion errors reject that action. Image content becomes native
base64 evidence; thumbnail paths resolve to URLs and remain URL metadata. The SDK
also accepts direct `data` plus `mimeType` instead of `src`, with a 10 MiB decoded
byte limit per image for both forms; Bookshop uses public
paths so its display and attachment references stay consistent.
Text and resource blocks use the exported `ModelContextBlock` type. Each block
supplies a friendly top-level `title`; the context panel reads `block.title`
without knowing protocol metadata. `AttachButton` only handles the clicked
button's pending and error feedback. `useModelContext` activates the
SDK's attachment coordination automatically, with no view configuration opt-in.

Each button awaits its own operation and reports failures. Completion does not
promise a visible composer chip on every host. The shared panel reads reconciled hook
state, reports pending/error, and lets the reader remove or clear attachments
independently of the cart. A failed desired entry can remain listed while the
error explains it is unsynced. After a definite failure, the next valid explicit
attachment change attempts synchronization once. Clear stays available when an
error leaves the desired attachment list empty. There is no retry button or
background replay loop. An uncertain host outcome stays blocked until the SDK
can establish safe ordering; another click cannot force a replay. The SDK owns
connection, capability checks, batching, host removal, and remount reconciliation.

This example intentionally omits `resource_link`: its small reading sample is
self-contained, with no external document to retrieve. The `bookshop://` URI
identifies that embedded resource; it is not an advertised remote resource.
Audio, 3D, file editing, and implicit background context add no useful behavior to
this book catalog. They are not simulated merely to exercise more primitives.

## Deep links

Supported app routes are `/` (library), `/books`, `/products/moonlit-atlas`,
`/products/small-hours`, `/products/paper-planets`, `/cart`, and `/settings`.
`/books?q=moon` opens the filtered catalog. Unknown products and malformed or
external URLs show a recoverable missing-page screen.

`BookshopRouter` uses React Router's
[`MemoryRouter`](https://reactrouter.com/api/declarative-routers/MemoryRouter). Its initial entry is the
validated host deep link when present, otherwise the opening tool's route.
`Shop` declares `/`, `/books`, `/products/:id`, `/cart`, `/settings`, and the
missing-page fallback with `Routes` and `Route`. Details read `id` with
`useParams`; the catalog reads `q` with `useSearchParams`.

Local page buttons use `useNavigate` and carry the current `useLocation().search`,
including repeated query parameters. Search edits clone those parameters and
replace only `q`, replacing the current memory-history entry instead of adding an
entry for every keystroke. Page changes push entries. A small `IncomingLink`
adapter forwards a changed host URL with `replace: true`; its previous-URL ref
prevents local navigation from reapplying an old host link. `appPath` validates
incoming app-relative URLs; it does not match screens or manage navigation.

The router stays mounted across tool-data refreshes, so refreshed cart/settings
data does not reset navigation or memory history. Nothing writes the host URL or
browser history. There are no browser Back/Forward claims or custom router
framework. React Router is the example's only additional runtime dependency.

The current `useDeepLink()` exposes only the latest URL string. If the host sends
A, the reader navigates locally to B, and the host explicitly sends A again, the
unchanged hook value cannot trigger navigation. Supporting that case requires an
SDK activation signal and a host that actually emits the repeated delivery.
Unrelated theme updates must not count as navigation. This example does not claim
to fix that separate SDK limitation.

Under Settings → Make a deep link, enter your registered plugin ID. The helper
percent-encodes the entire app-relative URL, including its query string:

```text
https://chatgpt.com/plugins/<encoded-plugin-id>/app/open_bookshop?path=%2Fbooks%3Fq%3Dmoon
https://chatgpt.com/plugins/<encoded-plugin-id>/app/open_bookshop?path=%2Fcart
```

Registration, installation, and a supporting host are required. Before registration,
call `open_bookshop` with `{"route":"/books?q=moon"}` or `{"route":"/cart"}` to
exercise the screen. This proves local rendering, not native deep-link delivery.
Global/thread launchers are fullscreen in supporting hosts; ordinary tool cards
prefer inline. Hosts may ignore presentation requests.

## Try it

- “Open Little Bookshop.”
- Search “moon”, open its cover, and return to Library; the search remains.
- Add two copies to the cart, then ask “What's in the demo cart?” (`read_cart`).
- Open a book, choose Add to chat, and ask about its cover illustration.
- Add book details and a reading sample, then remove only the cover from context.
- Change Compact library in Settings, or use native `settings.update`, then Refresh.

## Verification boundaries

Build, typecheck, lint, and formatting verify packaging and static correctness.
Use the Inspector to check actual tool calls, routing, theme, sizing, cart,
settings, attachments, host removals, and rejected-operation and recovery states.
The example has no committed test suite or test-only dependencies.

Native ChatGPT launcher placement, native settings controls, composer rendering,
and registered deep-link delivery require separate verification in a supporting
host. A local protocol harness does not establish those native-host guarantees.
