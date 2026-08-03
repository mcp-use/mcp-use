# Migrate v1 code to native v2

Use this mapping when reviewing or upgrading a project:

| V1-era pattern                   | Native v2 replacement                                                         |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `mcp-use/server`                 | `mcp-use`                                                                     |
| `schema` on a tool               | `inputSchema`                                                                 |
| `resources/<name>/widget.tsx`    | `views/<name>/view.tsx`                                                       |
| tool `widget` metadata           | `view: { name }`                                                              |
| `widget({ props, output })`      | `{ content, structuredContent }`                                              |
| `useWidget()`                    | `useToolContext()`                                                            |
| `McpUseProvider` wrapper         | no wrapper; use focused v2 hooks                                              |
| broad widget state/context hooks | `useViewState`, `useHostContext`, `useDisplayMode`, and related focused hooks |

Do not mechanically rename a tool's `schema` without checking context: prompt definitions still use `schema`.

After migration:

1. Search source and docs with `scripts/check-v2.mjs`.
2. Rebuild so View types are regenerated.
3. Confirm the package root imports and the removed server subpath does not.
4. Call every migrated rendering tool and verify pending, error, and ready UI states.
5. Test from a clean packed or published consumer when exports, peers, or package contents changed.
