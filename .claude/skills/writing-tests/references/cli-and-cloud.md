# Testing `@mcp-use/cli` commands

CLI tests spawn the **built** CLI (`dist/bin.js`) as a child process, point it
at a local fake of Manufact Cloud, and assert on what comes out. The harness
lives in `libraries/typescript/packages/cli/tests/helpers/`:

| File            | What it gives you                                       |
| --------------- | ------------------------------------------------------- |
| `cli-test.ts`   | `test`, a Vitest `test` with `cloud` and `cli` fixtures |
| `fake-cloud.ts` | `startFakeCloud()`, the `node:http` fake behind `cloud` |
| `run-cli.ts`    | `runCli()`, the child-process runner behind `cli`       |

`tests/cloud/deployments.test.ts` is the reference example.

## Build first

The runner executes `dist/bin.js`, so rebuild after every source change:

```bash
cd libraries/typescript
pnpm --filter @mcp-use/cli build   # about a second
pnpm --filter @mcp-use/cli exec vitest run tests/cloud/deployments.test.ts
```

The runner refuses to start when `dist/bin.js` is missing or older than any
file in `src/`, so a stale build can't make a broken change look green. CI
builds before it tests.

## A test, end to end

```ts
import { describe, expect } from "vitest";
import { test } from "../helpers/cli-test.js";

test("restart redeploys the same server and branch", async ({ cloud, cli }) => {
  signInToOrg1(cloud); // registers GET /api/v1/test-auth; see deployments.test.ts
  cloud.on("GET", "/api/v1/deployments/dep_1", {
    body: {
      id: "dep_1",
      status: "running",
      serverId: "srv_1",
      gitBranch: "main",
    },
  });
  cloud.on("POST", "/api/v1/deployments", {
    status: 201,
    body: { id: "dep_2" },
  });

  const result = await cli.run(["deployments", "restart", "dep_1", "--json"], {
    env: { MCP_USE_API_KEY: "test_key" },
  });

  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual({ id: "dep_2" });
  expect(cloud.requestsTo("POST", "/api/v1/deployments")).toMatchObject([
    { body: { serverId: "srv_1", branch: "main", trigger: "redeploy" } },
  ]);
});
```

Use `test` from `cli-test.ts` and `describe`/`expect` from `vitest`.

## The `cloud` fixture

A fresh fake Cloud per test, listening on `127.0.0.1` on a free port.

- `cloud.on(method, path, reply)` answers every matching call with `reply`.
- `cloud.sequence(method, path, [reply1, reply2])` answers one call per
  reply, in order. A call after the last reply counts as unhandled, which is
  how a test proves a poll loop stopped or a request was not repeated.
- A reply is `{ status?, body?, headers? }`, or a function of the recorded
  request that returns one. `body` is sent as JSON.
- `path` is the **full pathname** the CLI requests, such as
  `/api/v1/deployments`, with no query string. Assert on query parameters
  through `request.query`.
- `cloud.requests` lists every request in arrival order;
  `cloud.requestsTo(method, path)` filters it. Each one has `method`, `path`,
  `query`, `headers` (lower-case), `body` (parsed JSON, a string, or
  `undefined`) and `rawBody` (a `Buffer`, for multipart uploads).
- A request with no route gets a 501 reply and lands in `cloud.unhandled`.
  The fixture **fails the test** after it finishes if `unhandled` is not
  empty, so register only the routes the behaviour needs.

Routes are untyped for now. Once the CLI has a client generated from Cloud's
OpenAPI spec, the harness will type routes and bodies against it.

## The `cli` fixture

A sandbox wired to the test's fake Cloud.

- `cli.run(args, { env, cwd, input, timeoutMs })` spawns
  `node dist/bin.js ...args` and resolves to
  `{ exitCode, stdout, stderr, json, errorJson }`.
- `json` is stdout parsed as **exactly one** JSON document, or `undefined`.
  Two JSON lines give `undefined`, so `expect(result.json).toEqual({...})`
  also checks "one document only". `errorJson` does the same for stderr,
  which is where `--json` errors go.
- The child runs with a clean environment: only `PATH`, temp-dir variables
  and the Windows basics are inherited. It gets:
  - `HOME` and `USERPROFILE` set to `cli.home`,
  - `XDG_CONFIG_HOME` set to `cli.configHome`,
  - `MCP_USE_CLOUD_API_URL` pointing at the fake,
  - `NO_COLOR=1`,
  - and whatever you pass in `env`.

  Your own `MCP_USE_API_KEY` or `~/.mcp-use` never reaches the test.

- The working directory is `cli.cwd`, an empty temp directory. Write project
  files there, or pass `cwd`.
- Stdin is a pipe, never a TTY. `input` is written to it, then it is closed.
  Commands that would prompt must fail with "pass --yes", and that is
  behaviour worth testing.
- Everything is deleted after the test.

## Recipes

**Signed in.** Pass `env: { MCP_USE_API_KEY: "test_key" }` and register the
identity route the command calls (today `GET /api/v1/test-auth`). The auth
PR in the CLI rewrite stack replaces this with a shared helper.

**JSON errors.** Assert the exit code and the error `code`, not the message:

```ts
expect(result.exitCode).toBe(1);
expect(result.errorJson).toMatchObject({
  error: { code: "deployment_not_found" },
});
```

**Exit codes.** 0 for success or help, 2 for usage errors and missing
confirmation, 1 for API or operational failures.

**Files the CLI writes.** Read them back from `cli.home` or `cli.cwd` after
the run, and compare to literal content.

**Agents are the main users.** Most tests should use `--json`, assert the
whole document with `toEqual`, and check `stderr` is empty on success. Keep a
few human-mode tests for formats people or scripts read, such as tables.

**Polling commands.** The CLI sleeps for real between polls (one second for
build logs). Give the fake two replies, not ten, so the test stays fast and
still proves the loop advances and stops.

**Non-mcp-use projects.** Manufact Cloud must work for any project. When a
command reads the project, cover at least one case where `cli.cwd` is not an
mcp-use project (no `mcp-use` dependency, or not Node at all).

## Gotchas

- **Never use `spawnSync` or `execFileSync` for the CLI.** The fake runs on
  the test's event loop. A synchronous spawn blocks it and the CLI hangs.
- **Rebuild after editing `src/`**, including during the reviewing-tests
  break edits. The stale-build guard catches a forgotten rebuild.
- **Don't mock our own modules** in harness tests. If a behaviour can't be
  reached from argv, env, files and the fake, ask whether it is behaviour.
- Tests in one file run one after another, and each has its own server and
  directories, so they never share state.
