# CLI integration fixtures

Import `it` from `./fixtures.js` for a basic project, `viewsTest` for the views
project, or `emptyTest` when only files are needed. Pure tests can use the same
functions without requesting a fixture; no project is created until requested.

```ts
import { expect } from "vitest";
import { it } from "./fixtures.js";
import { listToolNames } from "./helpers.js";

it("serves the fixture's tools", async ({ project }) => {
  const server = await project.startDev({ inspector: false });
  expect(await listToolNames(server.url)).toEqual(["add"]);
  project.writeFile("notes/example.txt", "test-owned file");
});
```

`project.cwd` works with existing CLI functions and filesystem assertions.
`project.startDev()` runs the local CLI source and automatically owns shutdown,
including failed startup. The returned `stop()` is idempotent and can be called
explicitly when testing shutdown or sequential starts. Tests that need multiple
projects request `{ projects }` and call `projects.create("basic" | "views" |
"empty")`; all their resources close before any project is removed.

Register additional clients, listeners, and mocks with `project.defer(cleanup)`
immediately after acquiring them. Callbacks run in reverse acquisition order and
are awaited. The lifecycle continues after cleanup failures and reports them
together. Do not register directory removal or server shutdown manually.

Each runnable fixture declares its dependencies in its own `package.json`.
Setup links those dependencies from the local installation and links `mcp-use`
to the local server package. Zod is the fixture's chosen validator; it is not
assumed to be supplied by the framework. These are repository-backed integration
tests, not package-install tests. Build the workspace before running them, and
rebuild the server package when changing its exported build. No registry fetch or
dependency installation happens during fixture setup.

From `libraries/typescript`, run:

```sh
pnpm build
pnpm --filter @mcp-use/cli test:run
```

Each invocation owns a unique `tests/cli/.tmp/run-*` root. Test teardown stops
resources and removes projects, even after a failing test. Runner teardown then
sweeps only that invocation's root and removes `.tmp` if empty. Concurrent runs
and leftovers from older versions are never recursively deleted together.

For deliberate inspection, run `KEEP_TEST_PROJECTS=1 pnpm --filter @mcp-use/cli
test` (PowerShell: set `$env:KEEP_TEST_PROJECTS = "1"` first). Servers still stop;
the retained root is printed. Git, ESLint, and Prettier ignore scratch projects
because forced termination can prevent teardown. No cleanup mechanism can run
after SIGKILL or power loss; old retained roots must be removed when no longer
needed.

The project lifecycle uses the package-wide resource scope described in
[../README.md](../README.md). `project.defer(cleanup, "resource name")` also
returns an idempotent close function and passes a cancellation signal to cleanup.
Shutdown has a five-second deadline plus one second of cancellation grace. A
resource that still cannot stop causes an explicit cleanup failure and retention
of the run's files; the runner does not claim that an active resource was cleaned
up merely because a timer expired.
