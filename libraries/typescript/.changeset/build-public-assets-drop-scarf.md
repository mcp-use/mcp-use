---
"mcp-use": patch
"@mcp-use/client": patch
"@mcp-use/inspector": patch
---

Fix duplicated public assets in production builds and remove Scarf telemetry.

**mcp-use**

- Set `publicDir: false` on all Vite build steps so project `public/` is copied only to `.mcp-use/build/views/public/` (not duplicated at the build root or inside each view outDir).
- Raise the view client build `chunkSizeWarningLimit` to reduce noisy warnings for large view bundles.

**@mcp-use/client**

- Remove Scarf download telemetry (`captureScarf`, beacon helpers, and related storage); PostHog remains the sole telemetry provider.

**@mcp-use/inspector**

- Drop inspector package-download Scarf tracking on init; update README and e2e docs to reflect PostHog-only telemetry.
