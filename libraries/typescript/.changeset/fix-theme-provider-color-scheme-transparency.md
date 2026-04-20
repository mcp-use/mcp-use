---
"mcp-use": patch
---

ThemeProvider: gate color-scheme on opt-in prop to fix transparent iframe backgrounds.

Setting `color-scheme` to an explicit value ("dark"/"light") on the iframe document root causes browsers to paint an opaque canvas behind the iframe when the widget and host documents use different schemes, making `background-color: transparent` ineffective.

`McpUseProvider` now accepts a `colorScheme?: boolean` prop (default `false`). When `false`, `ThemeProvider` clears any previously set `color-scheme` inline style, preserving iframe transparency. When `true`, the previous behavior is restored (useful for widgets that need native dark scrollbars or CSS `light-dark()`).

Theme class (`dark`/`light`) and `data-theme` attribute are unaffected.
