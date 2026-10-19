---
"@mcp-use/cli": patch
"mcp-use": patch
---

Tailwind fixes for `landing.tsx` pages:

- The page now sets `data-theme` on `<html>` from the OS color scheme before the first paint and follows OS changes, so `dark:` classes work on the landing page without a theme script. A page that sets `data-theme` itself, for example from a theme toggle, keeps its value.
- A page whose CSS imports Tailwind itself (`@import "tailwindcss"`, for `@theme`, `@utility` or a custom `dark` variant) now owns Tailwind: the CLI-managed stylesheet is left out, so only the page's copy is compiled and its `dark` variant is the only one.
- In `mcp-use dev`, the page head links the stylesheets the page imports, so server-rendered markup no longer appears unstyled until the page's JavaScript loads.
