---
"@mcp-use/cli": patch
---

fix(cli): tests no longer touch the developer's real `~/.mcp-use` directory

Two leaks are closed:

- `session-storage.test.ts` computed its target path from `os.homedir()` and `rmSync`'d it in `beforeEach`/`afterEach`, so running `pnpm test` during local development deleted any saved clients on disk. The tests now mock `node:os.homedir` to a per-process temp directory.
- `cli-integration.test.ts` spawned the real CLI as a subprocess and so read the developer's real `cli-sessions.json` when running `client list`. `runCLI` now sets `HOME` (and `USERPROFILE`) to an isolated temp dir for every spawn.
