---
"mcp-use": patch
---

Resolve all open Dependabot security advisories in the TypeScript workspace. Bumps the `hono` direct dependency to `^4.12.18` and raises the pinned floors in `pnpm.overrides` for `axios`, `protobufjs`, `@protobufjs/utf8`, `ws`, `uuid`, `fast-uri`, `ip-address`, `postcss`, `langsmith`, `follow-redirects`, `dompurify`, `qs`, `react-router`, `vitest`, and `better-auth` so the lockfile resolves to patched versions. All bumps stay within compatible major lines (e.g. `protobufjs` and `uuid` are bounded to their current majors) to avoid breaking changes.
