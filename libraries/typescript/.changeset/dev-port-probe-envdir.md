---
"mcp-use": patch
---

Fix `mcp-use dev` port auto-find and Vite env deprecation warning.

- Replace deprecated Vite `envFile: false` with `envDir: false` in dev/build/view CLI paths.
- On localhost-class binds, treat a port as taken when loopback (`127.0.0.1` or `::1`) already accepts connections — restores CLI v1 behavior when another process owns `*:port` (e.g. Next.js on macOS dual-stack).
