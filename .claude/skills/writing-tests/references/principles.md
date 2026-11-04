# Test principles, in depth

## Behaviour versus implementation

**Behaviour** is anything a user of the code can observe through the interface
they actually use:

| Surface          | Observable behaviour                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI command      | exit code; stdout; stderr; the `--json` document; the error `code` in a JSON error; files written under HOME or the project; requests sent to Cloud; processes or browsers it launches |
| Library function | return value; thrown error type or `code`; state readable through the public API; effects on outside systems                                                                           |
| HTTP server      | status; response body; headers; effects on its stores or downstream services                                                                                                           |

**Implementation** is everything else: private helpers, the order of internal
calls, intermediate data, which module did the work, how many times an
internal function ran.

The contract decides, not the shape of the assertion:

- "A request with this body reached Cloud" is behaviour, because Cloud sees
  it. "`api.request` was called with these arguments" is implementation, since
  `api.request` is our own wrapper and nobody outside sees it.
- Callers branch on `error.code` (`deployment_not_found`), so assert the code.
  The `message` is prose for humans; pin it only when the exact wording is the
  requirement.
- An empty list is the right assertion when "nothing matches" is the
  requirement. It is a hollow assertion when the test just needs "something
  came back".
- An invariant can be the behaviour: "every command in `--help` has a
  dispatcher", "the dist entry names stay stable".

## Literal expected values

The expected value comes from the requirement, written out in the test.

```ts
// Bad: the expected value comes from the code under test, so a bug in
// formatDeploymentList is copied into the expectation.
expect(stdout).toBe(formatDeploymentList(fixture) + "\n");

// Good: the reader can check this against the spec by eye.
expect(stdout).toBe(
  "DEPLOYMENT\tSERVER\tSTATUS\tTRIGGER\tBRANCH\tCREATED\tERROR\n" +
    "12345678\tserver_1\tfailed\tmanual\tmain\t2026-07-24T00:00:00Z\tBuild failed\n",
);
```

The same goes for restated constants. Copying `HELP` text into a test and
comparing it to the `HELP` constant never runs the code that prints it. Run
`mcp-use deployments --help` and check what comes out.

## Don't mock what you can run

Mocks hide the bugs that live in the parts they replace. The old
`deployments.test.ts` replaced `cloud-api.js` with `vi.mock` and spied on
`process.stdout.write`. It could not see:

- the URL, query string or headers the CLI sent,
- how `--json` errors reach stderr and the exit code,
- argument parsing in `bin/`,
- whether the command was wired into the router at all.

Run the real thing wherever it is cheap: the built CLI in a child process,
real temp directories, real `git`. Fake only what you cannot run locally or
must not touch from a test:

- **Manufact Cloud:** use the fake-Cloud harness (see `cli-and-cloud.md`).
- **GitHub or other HTTP services:** a local `node:http` server, or a fake
  executable on `PATH` that records its argv. pstack's `watch-pr` tests are a
  good model: they put a fake `gh` on PATH and run the real subprocess.
- **The browser:** point the opener at a fake executable that records the URL.

Treat what a fake receives as part of the assertion. If the requirement is
"restart sends the server id and the branch", assert on the body Cloud
received.

## "Nothing happened" needs a positive twin

`expect(cloud.requests).toEqual([])` passes just as well when the harness is
miswired and could never see a request. Pair it with a test in the same file
where the request does happen and is seen. The fake-Cloud fixture helps here:
every request that hits no registered route fails the test, so registering
only the routes you expect is itself a "nothing else happened" check, and the
routes you do register prove the fake can see traffic.

## Things to avoid

- **Snapshots of human prose.** They fail on every wording tweak and pass on
  real regressions hidden in a large blob. Assert on the parts that are the
  contract: a table format that scripts parse, a JSON document, an error code.
- **Sleeps and timing races.** Never `await sleep(…)` hoping something has
  finished. Wait for the process to exit or for the fake to receive a
  request. If the code under test polls with a real delay, keep the number of
  polls small (two replies, not ten) rather than faking timers in a child
  process.
- **Assertions on data the test built.** If the test writes a fixture and
  then asserts that the fixture has a field, the code under test never ran.
- **Loose assertions.** `toContain("failed")` passes for the wrong row, and
  `toBeTruthy()` passes for the wrong object. Use the tightest assertion the
  contract allows: `toBe`, `toEqual`, or `toMatchObject` on the fields that
  matter.
- **Over-pinning.** `toEqual` on a whole API response pins fields the
  contract does not promise. Use `toMatchObject` for those, and `toEqual` for
  `--json` documents where every field is part of the agent contract.

## When a unit test is still right

Spawning the CLI costs about 100 ms. A pure function with a real contract and
many input cases (an argument parser, a path normaliser, a redaction
function) can be tested directly through its exported API, as long as:

- the function's inputs and outputs are what callers depend on, and
- the test still passes after any refactor that keeps those inputs and
  outputs the same.

If a test needs `vi.mock` of our own modules to reach the function, test
through the command instead.

## The two-edit check

For each test, imagine (or, with the `reviewing-tests` skill, actually make)
two edits:

1. **Break the behaviour:** return a wrong value, skip an effect, or do it
   twice. If the test still passes, it proves nothing. Usual causes: an
   assertion looser than the contract, an expected value computed by the code,
   a restated constant, an assertion on the test's own data.
2. **Restructure the internals** with every observable result unchanged:
   inline a helper, rename a private function, split a module, reorder
   independent calls. If the test fails, it is pinned to the implementation
   and will break on every refactor without catching bugs.

Keep tests that fail edit 1 and pass edit 2. Rewrite or delete the rest.

## Workflow details

- **Failing first.** Run the new test before the change and read the
  failure. "Expected exit code 0, got 2 (`usage_error`)" is the right failure
  for a missing flag; "ENOENT dist/bin.js" is a setup failure, so fix the
  setup first.
- **Bug fixes.** Commit the failing test, then the fix, so `git log` shows
  the test failing without the fix.
- **Run the real thing.** After the tests pass, run the built CLI once by
  hand the way an agent would (`node dist/bin.js deployments list --json`
  against a fake or staging Cloud) and read the output.
- **No test is fine.** If the only possible test needs heavy mocking, timing
  luck or a large fixture that tests nothing, skip it and say in the PR how
  you verified the change instead.
