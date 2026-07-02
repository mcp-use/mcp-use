# @mcp-use/server

Greenfield v2 server SDK rebuild. `specs/SPEC.md` in this directory is the working contract — read it before changing anything. API-shape decisions, per-phase deltas, and dependency ground rules live there, not here.

## Doc comments: TSDoc, everywhere

Every export — classes, methods, functions, interfaces, type aliases, enum members, and the properties of public types — carries a doc comment in strict [TSDoc](https://tsdoc.org/) syntax. These comments feed the generated API reference, so write them as public documentation, not code notes.

Both halves are lint-enforced (scoped block in the root `eslint.config.js`): `tsdoc/syntax` rejects malformed TSDoc, and `jsdoc/require-jsdoc` fails on undocumented exported declarations. Only that one jsdoc rule is enabled — do not enable jsdoc tag-style rules (`require-param` etc.); comment *content* is governed by the rules below, not by the linter.

- TSDoc, not JSDoc: types come from the signature, never from the comment (`@param {string} name` is wrong). Use `@returns` not `@return`, `@typeParam` not `@template`.
- `@param` uses a hyphen separator: `@param name - What the value means, its constraints, its default.`
- Open with a one-sentence summary. Elaboration goes after a blank line or under `@remarks`.
- Anything a user calls directly gets an `@example` with a fenced ` ```ts ` code block.
- Use `@defaultValue` on optional config fields, `@throws` on deliberate error paths, and `{@link Symbol}` (not a bare backticked name) when referring to another exported symbol.
- A symbol exported only for internal wiring is tagged `@internal`.
- Non-exported helpers need a comment only when the name doesn't carry the meaning — but any comment they do get is still TSDoc.
- A doc comment that restates the signature (`@param name - the name`) is worse than none; say what the type can't.
- Behavior change and doc-comment update land in the same edit. A stale doc comment is a bug.
