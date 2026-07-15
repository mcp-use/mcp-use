# Tic-Tac-Toe example

Minimal MCP Apps views server where the **model plays as an opponent** through
an ephemeral `useViewTool`-registered tool. The user plays X by clicking cells;
the model plays O by calling `place-mark` while the view is open.

## What this demonstrates

- **Model-as-opponent via `useViewTool`** — the view registers `place-mark`
  while mounted; the model calls it to place O marks. Game state lives entirely
  in React state inside the view.
- **Stable discovery** — `place-mark` remains registered while the view is
  mounted; its handler rejects calls made out of turn or with an illegal cell.
- **`ModelContext`** — board state (9-cell array, turn, outcome) is exposed so
  the model can pick a legal cell.
- **`useSendFollowUp`** — after the user places X, the view prompts the model
  to take its turn.
- **One tool ↔ one view** via `view: { name, description, prefersBorder }` on
  `start-game`.
- **Zero-codegen typing** via `src/tools.d.ts` and the exported `startGame`
  tool ref.
- **Tailwind CSS v4** — `vite.config.ts` (`@tailwindcss/vite`) and
  `@import "tailwindcss"` in `view.css`.

## Game contract

- Board is a 9-cell array, indices **0–8**, row-major (0 top-left, 8
  bottom-right).
- User is **X**; model is **O**.
- `place-mark` input: `{ cell: number }` (0–8).
- Successful `place-mark` results include structured board state (`cell`,
  serialized `board`, `winner`, and `nextTurn`) for the host and model.
- Rejected with `isError` when it is not the model's turn or the cell is
  already taken.

## Tools

| Tool | View | Purpose |
| --- | --- | --- |
| `start-game` | `tic-tac-toe` | Start a fresh game and open the interactive board |
| `place-mark` | — (view tool) | Registered by the view via `useViewTool`; model places O |

## Run locally

From this directory:

```sh
pnpm install   # once, from the monorepo root or here
pnpm dev
```

`mcp-use dev` serves MCP at `http://127.0.0.1:3000/mcp`. Preview the view
through the built-in inspector (linked in the dev server log): open the
`ui://views/tic-tac-toe.html` resource via `resources/read`.

Production path:

```sh
pnpm build && pnpm start
```

## Typing (`tools.d.ts`)

```ts
// src/tools.d.ts
declare module "@mcp-use/server/react" {
  interface Register {
    tools: typeof import("./index.js");
  }
}

export {};
```

Export the tool ref from `src/index.ts` (`export const startGame = …`). Then
`useToolContext<"start-game">()` infers input/output types from that ref.

See [Views spec — Typing](../../../specs/VIEWS_SPEC.md#typing-toolref--register-zero-codegen)
for the full contract.

## Typecheck

```sh
pnpm typecheck
```

Requires a built `@mcp-use/server` (`pnpm build` in `packages/server`) so
`dist/react/index.d.ts` resolves.
