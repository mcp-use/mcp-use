# testing-foundations

Compile-time type-testing server for the `mcp-use` library. Exercises every typed API surface of `mcp-use/server` and `mcp-use/react` so that `tsc --noEmit` catches type-breaking changes or regressions.

This is not a production server — it is a **lint-as-a-test** project.

## Quick Start

```bash
pnpm install
pnpm lint     # tsc --noEmit — the primary check
pnpm build    # mcp-use build — widgets + TS compilation + type-check
```

## File Structure

```
testing-foundations/
├── index.ts                      # Server: 24 tools, 7 resources, 3 prompts
├── resources/
│   └── everything-widget.tsx     # Widget: full mcp-use/react API coverage
├── package.json
├── tsconfig.json
└── .env.example                  # WEATHER_API_KEY (optional, used by one tool)
```

## What `index.ts` Covers

Each tool, resource, and prompt targets a distinct `mcp-use/server` type signature:

| Category | Concepts Tested |
|---|---|
| **Server init** | `MCPServer` constructor (name, title, version, baseUrl) |
| **Middleware** | `server.use()` — Hono-style `(c, next)`, Express-compatible `express-rate-limit` |
| **HTTP endpoints** | `server.app.get()` for `/health`, `/api/version` |
| **Tool schemas** | Empty schema, `.describe()`, `.optional()`, `.default()`, `.min()`, `.max()`, `.email()`, `.url()`, `z.enum`, `z.array`, `z.object` (nested), `z.record` |
| **Tool annotations** | `destructiveHint`, `readOnlyHint`, `openWorldHint` |
| **Tool context** | `ctx.reportProgress()`, `ctx.log()`, `ctx.sample()`, `ctx.client.can()`, `ctx.client.capabilities()`, `ctx.elicit()`, `ctx.session.sessionId`, `ctx.sendNotification()` |
| **outputSchema** | Typed structured output with `object()` return |
| **Widget config** | `widget: { name, invoking, invoked }`, `widget()` response helper |
| **Response helpers** | `text()`, `object()`, `markdown()`, `error()`, `image()`, `html()`, `xml()`, `css()`, `javascript()`, `binary()`, `audio()`, `array()`, `resource()`, `mix()`, `widget()` |
| **Resources** | Static (`server.resource()`), dynamic, cached (Map-based TTL), templated (`server.resourceTemplate()`) with static and async completions |
| **Prompts** | Basic schema, `completable()` static list, `completable()` dynamic async with `ctx.arguments` |

## What `everything-widget.tsx` Covers

A single React widget exercising the full `mcp-use/react` API:

- `widgetMetadata` with `WidgetMetadata` type, `propsSchema`, `exposeAsTool: false`
- `useWidget<Props>()` — `props`, `isPending`, `callTool`, `state`, `setState`, `theme`, `toolInput`, `output`, `displayMode`, `safeArea`, `maxHeight`, `userAgent`, `locale`, `mcp_url`, `isAvailable`
- `useWidgetProps<Props>()`, `useWidgetState<T>()`, `useWidgetTheme()` standalone hooks
- `isPending` guard, `CallToolResponse` type, `McpUseProvider autoSize`
- `ErrorBoundary` (library + custom class-based `Component<P, S>`)
- `React.memo`, `useReducer` (discriminated union), `useState` (explicit generics), `useMemo`, `useCallback`, `useEffect`, custom `useDebounce<T>` hook
- `FormEvent<HTMLFormElement>`, `CSSProperties`, `Theme` type

## Known Type Errors (3)

These are intentionally kept as regression markers for known `mcp-use` library issues with pending PRs. Once the PRs land, these errors should disappear and `pnpm lint` should pass cleanly.

| Error | Location | Issue |
|---|---|---|
| `object()` inside `mix()` | `process-file` tool | `TypedCallToolResult<T>` not assignable to `CallToolResult` in `mix()` |
| `object()` inside `mix()` | `all-helpers-mix` tool | Same as above |
| `error()` + `outputSchema` | `calculate-stats` tool | `error()` returns `CallToolResult` with `structuredContent: { [key: string]: unknown }`, incompatible with `TypedCallToolResult<T>` |

## License

MIT
