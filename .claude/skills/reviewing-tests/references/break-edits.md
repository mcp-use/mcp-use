# Choosing the edits

A good break edit is the **smallest** change that a user would notice and the
test claims to catch. A huge edit (deleting the command) proves little,
because almost any test fails when the command is gone.

## Break edits by kind of behaviour

| The test claims                         | Break it by                                 | Example in `@mcp-use/cli`                                                                        |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A value in the output                   | changing it by one character or one field   | print `shortId` with 7 characters instead of 8; drop the `status` field from a `--json` document |
| Formatting rules (truncation, ordering) | removing the rule                           | print the whole multiline error instead of the first line                                        |
| A request Cloud receives                | changing one part of it                     | send `limit=31`; drop the `x-profile-id` header; send `branch` from the wrong source             |
| An effect happens                       | skipping it                                 | return before the `POST /deployments`; don't write the config file                               |
| An effect happens once                  | doing it twice                              | call the endpoint again; `printResult` twice in `--json` mode                                    |
| A loop stops                            | letting it run once more, or stopping early | add `"building"` to the terminal statuses; ignore the terminal status once                       |
| State carried between steps             | not carrying it                             | keep sending `offset=0` instead of the returned offset; don't accumulate logs                    |
| An error and its code                   | changing the code or exit status            | return `cloud_api_error` instead of `deployment_not_found`; exit 1 instead of 2                  |
| Nothing happens                         | making it happen                            | send the request even though confirmation was missing                                            |

For each test, list the claims it makes (its assertions), and plan one break
per claim. Each break should fail with a message that shows that claim being
violated. If the only failure is unrelated (a crash, a timeout, an assertion
about something else), the claim you meant to target is not really checked.
An extra request can surface twice: first as the fake's 501 in stderr, then
as the unhandled-route check at teardown. Both show the break.

## Restructure edits

The restructure must keep every observable result identical. Pick one that
moves code the test might be leaning on:

- inline a private helper into its caller, or extract a block into a new
  helper;
- rename a private function or local type;
- move a function to another module in the same folder and import it;
- reorder independent statements (two header spreads, two variable
  declarations);
- replace a loop with `map`/`filter` or the reverse;
- change how a value is built while producing the same string.

If the test fails, find what it depends on (a module path in `vi.mock`, a
spy on an internal function, a call order) and say what to assert instead.

## CLI harness specifics

- The tests run `dist/bin.js`. After each source edit and each revert, run
  `pnpm --filter @mcp-use/cli build` from `libraries/typescript`. The runner
  refuses a stale build, so a forgotten rebuild shows up as a "stale build"
  error, not a false pass.
- Run one test with
  `pnpm --filter @mcp-use/cli exec vitest run <file> -t "<test name>"`.
- A route the test didn't register fails the test during fixture teardown
  with "fake Cloud received requests with no registered route". When a
  "done twice" break is caught that way, quote that failure as the evidence.
- A break that makes the CLI hang shows up as the runner's timeout. That
  counts as a setup failure, not a caught break: pick a different edit.

## Recording evidence

Keep, per test:

1. the break edit as a unified diff (`git diff -- <file>`),
2. the test output lines that show the failing assertion,
3. the restructure edit as a diff,
4. the passing test output,
5. the verdict.

Save the raw output to a scratch file while you work. The report quotes only
the lines that show the failing assertion.
