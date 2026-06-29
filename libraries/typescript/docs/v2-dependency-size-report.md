# V2 dependency & size report

**Branch:** `V2` · **Version:** `2.0.0-alpha.0` · **Generated:** 2026-06-27

Snapshot of the TypeScript monorepo after Phase 4 (externalized CLI/inspector, ESM-only, MCP SDK v2 split, `@mcp-ui/server` removed).

---

## Executive summary

| Layer | v2 posture |
|-------|------------|
| **`mcp-use` runtime deps** | 7 direct + 2 optional — Hono, MCP SDK v2, jose, posthog-node |
| **Published JS (server)** | ~386 KB entry (`mcp-use/server`), ~1.5 MB total JS in tarball |
| **CLI / Inspector** | Not bundled in `mcp-use`; explicit devDependencies |
| **`@mcp-use/client` / `@mcp-use/agent`** | Thin re-export shims (~100 B JS each); real code lives in `mcp-use` |
| **Monorepo dev install** | ~1.1 GB `node_modules` (all packages + dev tooling) |

---

## Runtime dependencies by package

### `mcp-use` (2.0.0-alpha.0)

| Kind | Package | Notes |
|------|---------|-------|
| **dependencies** | `@hono/node-server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `chalk`, `hono`, `jose`, `node-mocks-http`, `posthog-node` | Server runtime |
| **optionalDependencies** | `cli-highlight`, `redis` | Terminal colors; Redis session store |
| **peer (optional)** | `@mcp-use/cli`, `@mcp-use/inspector`, `@e2b/code-interpreter`, LangChain stack, `langfuse*`, `posthog-js`, `react`, `react-router`, `zod` | Not installed unless the app opts in |

**Removed since v1:** `@mcp-ui/server`, bundled `@mcp-use/cli`, bundled inspector UI, `express`, hard `@modelcontextprotocol/ext-apps`, transitive LangChain from inspector path.

### `@mcp-use/client` / `@mcp-use/agent`

| Kind | Package |
|------|---------|
| **dependencies** | `mcp-use` (workspace re-export) |
| **peer** | client: `@modelcontextprotocol/client`, `zod`, optional `@e2b/code-interpreter` · agent: LangChain + `zod` |

### `@mcp-use/cli` (3.6.0)

| Kind | Package |
|------|---------|
| **dependencies** | `mcp-use`, `vite`, `esbuild`, `tsx`, `chokidar`, `commander`, `chalk`, `dotenv`, `open`, `tar`, `ws`, `zod`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `vite-plugin-singlefile`, `jsonc-parser` |
| **peer** | `react`, `react-dom`, `react-router-dom` |

Dev-only tooling (Vite/esbuild) is **not** pulled in by `mcp-use` alone.

### `@mcp-use/inspector` (11.0.0)

| Kind | Package |
|------|---------|
| **dependencies** | `mcp-use`, `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `hono`, `@hono/node-server`, `posthog-node`, `zod`, `open`, `@scarf/scarf` |
| **peer** | `mcp-use`, `react`, `react-dom`, `react-router`, optional `express` |
| **devDependencies** | Full React UI stack (Radix, Tailwind, Vite, Playwright, …) |

Production default: UI from **CDN** (`inspector-cdn.mcp-use.com`); npm tarball is mostly server mount + CDN artifact.

### `create-mcp-use-app` (0.14.17)

| Kind | Package |
|------|---------|
| **dependencies** | `ink`, `react`, `commander`, `chalk`, `ora`, `tar` |

---

## Published bundle sizes (`dist/`)

Measured after `pnpm build` in `libraries/typescript`.

| Package | `dist/` total | JS (bytes) | `.d.ts` (bytes) | npm tarball |
|---------|---------------|------------|-----------------|-------------|
| **mcp-use** | 4.0 MB | 1,513,695 | 642,425 | ~800 KB–1.2 MB (est. from dist) |
| **@mcp-use/client** | 16 KB | 99 | — | 1 KB |
| **@mcp-use/agent** | 16 KB | 104 | — | 1 KB |
| **@mcp-use/cli** | 2.1 MB | 719,597 | — | 486 KB |
| **@mcp-use/inspector** | 18 MB | 14,759,500 | 165,882 | 4.6 MB |
| **create-mcp-use-app** | 748 KB | 39,512 | 2,004 | 526 KB |

### `mcp-use` entrypoints (JS only)

| Export path | Size |
|-------------|------|
| `mcp-use/server` | **386 KB** |
| `mcp-use` (root) | 191 KB |
| `mcp-use/react` | 171 KB |
| `mcp-use/agent` | 70 KB |
| `mcp-use/client` | 37 KB |
| `mcp-use/browser` | 0.8 KB |
| `mcp-use/jsx/jsx-runtime` | 0.3 KB |

Total JS under `packages/mcp-use/dist`: **~1.48 MB** (chunked ESM; Node loads only what you import).

### Inspector CDN bundle (production UI)

| Asset | Raw | gzip |
|-------|-----|------|
| `dist/cdn/inspector.js` | 5,199 KB | 1,369 KB |
| `dist/cdn/inspector.css` | 127 KB | 20 KB |

Not installed via npm in the default CDN path.

---

## Install footprint vs bundle

| Scenario | What gets installed | Typical size |
|----------|---------------------|--------------|
| **MCP server (prod)** | `mcp-use` + 7 runtime deps + MCP SDK transitive | **~25–45 MB** `node_modules` (estimate; peers not included) |
| **+ LangChain agent** | above + `@langchain/*`, `langchain` (peer) | **+80–150 MB** |
| **+ CLI (dev)** | `@mcp-use/cli` + Vite/esbuild tree | **+150–250 MB** |
| **+ Inspector (dev, local UI)** | `@mcp-use/inspector` dev graph | **+200 MB+** (React/Vite in devDeps) |
| **Inspector (prod, CDN)** | `@mcp-use/inspector` server mount only | **~same as server** + small server `dist` |
| **Monorepo contributor** | all workspaces + test tooling | **~1.1 GB** (measured) |

> **Note:** A mistaken `npm install` of published **v1 canary** from the registry (without `--ignore-scripts` on a local pack) still resolves the old fat graph (~455 MB+ with LangChain/Vite). V2 local packs should use `npm pack --ignore-scripts` to measure accurately.

---

## Architecture vs install size

```
Consumer app
├── mcp-use/server     ← 386 KB JS entry, ~7 runtime deps
├── @mcp-use/client    ← shim → mcp-use/client (37 KB)
├── @mcp-use/agent     ← shim → mcp-use/agent (70 KB) + LangChain peers
├── @mcp-use/cli       ← dev only; Vite/esbuild not in mcp-use
└── @mcp-use/inspector ← server mount; UI from CDN by default
```

**Install size** is dominated by **transitive npm deps**, not published `dist/` bytes. **Bundle size** (what ships on npm) is dominated by `mcp-use` server + inspector CDN artifact.

---

## Knip dependency health

`pnpm knip --dependencies` reports **no unused dependencies** in workspace packages (one config hint: CLI dynamically resolves `@mcp-use/inspector`).

---

## Recommendations

1. **Server-only apps:** depend on `mcp-use` only; add `@mcp-use/cli` to `devDependencies`.
2. **Client/agent apps:** prefer `@mcp-use/client` / `@mcp-use/agent` imports; install LangChain peers only when using agents.
3. **Inspector in production:** use CDN default; avoid installing inspector UI dev graph in prod images.
4. **Measure your app:** `npm pack --ignore-scripts && npm install ./mcp-use-*.tgz --omit=dev` in a clean dir for ground-truth install size.
