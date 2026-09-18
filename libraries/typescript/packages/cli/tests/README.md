# CLI test lifecycles

Tests that allocate resources use fixtures built on `support/scope.ts`. Pure
parsing tests and tests with only Vitest mocks can keep ordinary Vitest hooks.
The scope owns cleanup; scenario helpers describe the files or behavior a test
needs, such as an OAuth entry or a built production entry.

| Test needs                                     | Import `it` from          | Request                         |
| ---------------------------------------------- | ------------------------- | ------------------------------- |
| Local CLI dev/build project                    | `./cli/fixtures.js`       | `{ project }` or `{ projects }` |
| Empty files, isolated home, or other resources | `./support/fixtures.js`   | `{ scope }` or `{ home }`       |
| Production build and server                    | `./support/production.js` | `{ makeProject, start }`        |
| Git project and local remote                   | `./support/git.js`        | `{ git }`                       |

Paths above are relative to `tests/`; adjust them from a nested test file.
`cli/fixtures.js` also exports `emptyTest` and `viewsTest`.

```ts
import { expect } from "vitest";
import { it } from "./support/git.js";

it("works with a local repository", async ({ git }) => {
  const cwd = git.project("example");
  git.init(cwd, null);
  expect(git.run(cwd, "status", "--porcelain")).toBe("");
});
```

A fixture registers ownership before fallible setup or awaiting startup. Close
callbacks run in reverse acquisition order. Explicit closes and automatic
teardown use the same idempotent function. Global-state restoration runs even
when shutdown fails; directory removal follows resource shutdown. A failure in
one callback does not skip later callbacks.

Use `scope.defer(cleanup, "resource name")` for additional resources. Cleanup
receives an abort signal: after five seconds the scope requests cancellation and
allows one second for it to complete. Work started by a test can use
`scope.signal`, which aborts when teardown begins. Use `scope.preserveEnv()`,
`scope.preserveProperty()`, and `scope.preserveSignals()` before changing global
state. Tests using process-global state should not use `test.concurrent` within
the same worker; independent test files can run in parallel workers.

The local dev fixture stays inside `cli/.tmp/run-*` to resolve workspace packages.
Other temporary files, homes, and Git repositories use an invocation-owned root
in the OS temporary directory. Keeping Git fixtures outside the checkout prevents
a deliberately gitless fixture from discovering the parent repository. Both
roots have per-test cleanup and a final runner sweep. `KEEP_TEST_PROJECTS=1`
retains both roots and prints their locations, while still closing resources.

If a resource ignores shutdown and cancellation, teardown reports its name,
continues other cleanup, restores global state, and marks the run incomplete.
The runner retains that run's files instead of deleting files still in use.
In-process JavaScript cannot forcibly terminate an arbitrary pending operation;
this is a reported test failure, not successful cleanup. Forced termination of
the runner can also prevent cleanup entirely.

Use `support/requests.ts` for integration HTTP requests and polling. Requests
have a ten-second deadline covering headers and body consumption; requests made
inside `waitFor()` also inherit its deadline. Non-HTTP probes can use the signal
passed to their callback. `support/websocket.ts` owns socket closure and bounds
handshake waits.

The Node packaging tests use `support/process.mjs` and `t.after()`. Commands have
explicit deadlines, accept cancellation signals, terminate their process trees,
and wait for the child to close. Package installation gets a longer deadline
than a CLI version command. Small synchronous Git setup commands also have a
ten-second deadline. `process.test.mjs` verifies termination using real children
and descendants that ignore graceful shutdown.

See [cli/README.md](./cli/README.md) for local dependency linking and run commands.
