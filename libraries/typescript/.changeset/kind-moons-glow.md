---
"@mcp-use/inspector": patch
---

fix(inspector): stable grainy backgrounds, mesh connect backdrop, and dependency cleanup

- Use inline SVG noise data URLs on `RandomGradientBackground` (avoids blocked remote `noise.svg` requests).
- Add `@paper-design/shaders-react` mesh gradient behind the dashboard connect panel with a fine grain overlay, persisted play/stop control (shader motion), tooltip, and outline-only icon button.
- Remove unused packages (`@mcp-ui/client`, top-level `langchain`, `vite-express`, `@tailwindcss/cli`) and redundant ESLint/LangChain devDependencies; declare `tsup` for builds and add `pnpm run check-deps` via Knip (`knip.json`).
