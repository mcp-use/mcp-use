# @mcp-use/server

Greenfield v2 server SDK rebuild at `libraries/typescript/packages/server` (published as `mcp-use@2.x` at cutover). The old packages (`packages/mcp-use`, `packages/cli`, …) are the v1 feature reference only — nothing is ported wholesale, and they stay untouched until cutover.

## The specs are the source of truth

Every design decision lives in the package's `specs/` directory (paths below are relative to the package root). Read the relevant spec **before** changing anything; when behavior and spec disagree, one of them is a bug — fix them **in the same change**. Specs state the current contract only: no changelog narration, no dates on decisions, no "superseded by" trails. When a decision changes, rewrite the spec as if it had always been decided that way.

| Document | Governs | Status |
| --- | --- | --- |
| `specs/SPEC.md` | The core server: ground rules (stateless 2026-07-28-first wire, Standard Schema, no response helpers, dependency budget), the `MCPServer` API, phase plan | Phase 1 implemented |
| `specs/CLI_SPEC.md` | `mcp-use build`/`dev`/`start`, the bin + lazy toolchain layout, `.mcp-use/` workspace, entry contract, inspector CDN shell | Implemented |
| `specs/VIEWS_SPEC.md` | Views (MCP Apps): `view()` helper, view resources + wire metadata, the `/react` runtime and hooks, `ToolRef`/`Register` typing, views build/serve/dev | Design contract, pre-implementation |
| `specs/AUTH_SPEC.md` | OAuth resource-server posture, `ctx.auth`, provider adapters, RFC 9728 discovery | **Deferred** — blocked on official SDK auth support; do not start |

Decision records (`type_proposals.md`, `view_lifecycle_proposals.md` in the package root) preserve the rejected alternatives and evidence behind the specs' choices. They are history, not contract — where they differ from a spec, the spec wins.

## Doc comments: TSDoc, everywhere

Every export — classes, methods, functions, interfaces, type aliases, enum members, and the properties of public types — carries a strict [TSDoc](https://tsdoc.org/) comment. These feed the generated API reference: write them as public documentation, not code notes.

Lint-enforced (scoped block in the root `eslint.config.js`): `tsdoc/syntax` rejects malformed TSDoc; `jsdoc/require-jsdoc` fails undocumented exports. Only that one jsdoc rule is enabled — do not enable jsdoc tag-style rules (`require-param` etc.); comment *content* is governed here, not by the linter.

Style rules:

- TSDoc, not JSDoc — types come from the signature, never the comment (`@param {string} name` is wrong). `@returns` not `@return`, `@typeParam` not `@template`.
- `@param name - What the value means, its constraints, its default.` (hyphen separator).
- Open with a one-sentence summary; elaborate after a blank line or under `@remarks`.
- Anything a user calls directly gets an `@example` with a fenced ` ```ts ` block.
- Use `@defaultValue` on optional config fields, `@throws` on deliberate error paths, `{@link Symbol}` (not a bare backticked name) for other exported symbols, and `@internal` on exports that exist only for wiring.
- Non-exported helpers need a comment only when the name doesn't carry the meaning — but any comment they get is still TSDoc.
- A comment that restates the signature (`@param name - the name`) is worse than none; say what the type can't.
- Behavior change and doc-comment update land in the same edit. A stale doc comment is a bug — same rule as the specs.

## Working here

- Tests are real: e2e over HTTP with the official `@modelcontextprotocol/client`, plus compile-time contracts in `tests/type-level.test.ts`. `pnpm test:run` runs typecheck + the suite; both must pass before you're done.
- Adding behavior means adding the test that pins it (see `specs/*.md` Testing sections for what each phase must cover).
