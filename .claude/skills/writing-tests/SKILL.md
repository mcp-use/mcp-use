---
name: writing-tests
description: Use when writing, changing, or deciding whether to keep a test in this repo, especially in the @mcp-use/cli package. Tests assert what callers can observe (exit code, output, error codes, state, requests sent), use literal expected values, and run real code instead of mocks. Includes the fake-Cloud harness for CLI cloud commands.
---

# Writing tests

A test is a claim about what the code does for the people and programs that
use it. Write it so it fails when that behaviour breaks and keeps passing when
only the internals change. If you can't write a test like that, write no test:
**no new test beats a bad test.**

## Rules

1. **Test what callers can observe.** For the CLI that means the exit code,
   stdout and stderr, the error `code` that callers branch on, state they can
   read back (files, config), and effects outside the process, such as the
   requests Cloud receives. It does not mean private helpers, internal call
   order, or which module did the work.
2. **Expected values are literals from the requirement.** Write
   `"12345678\tserver_1\tfailed"`, not `formatRow(item)`. Never compute the
   expected value with the code under test.
3. **Don't mock what you can run.** Spawn the real CLI, write real files, run
   real git. Fake only the real outside boundaries (Manufact Cloud, GitHub,
   the browser). What a fake receives is behaviour, so assert on it.
4. **Pair every "nothing happened" assertion with a case where it happens.**
   A test that checks "no request was sent" also needs a case proving the
   test can see a request.
5. **Avoid** snapshots of human prose, exact error _messages_ (assert the
   `code`), sleeps and timing races, and assertions on data the test built
   itself.
6. **Apply the two-edit check** to every test you keep:
   - _Break the behaviour_ (wrong value, skipped effect, effect done twice).
     The test must fail.
   - _Restructure the internals_ without changing behaviour. The test must
     pass.

   Rewrite or delete any test that fails either edit. The `reviewing-tests`
   skill runs this check for real.

## Workflow

1. Name the behaviour in one sentence a user would agree with. That sentence
   is the test name.
2. Write the test first and run it. Confirm it fails, and that it fails on
   the assertion you meant, not on setup.
3. For a bug fix, commit the failing test before the fix so the history shows
   it failing.
4. Make it pass. Then run the real thing too (the built CLI against the fake
   or a real Cloud): green tests are not proof on their own.

## References

- [references/principles.md](references/principles.md): each rule in more
  depth, with good and bad examples from this repo.
- [references/cli-and-cloud.md](references/cli-and-cloud.md): how to test
  `@mcp-use/cli` commands with the fake-Cloud harness in
  `libraries/typescript/packages/cli/tests/helpers/`.

Adapted in our own words from the testing guidance in Cursor's
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT,
© 2026 Lauren Tan).
