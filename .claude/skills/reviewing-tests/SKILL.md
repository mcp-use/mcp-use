---
name: reviewing-tests
description: Use when reviewing tests in a diff or PR in this repo, or before opening a PR that adds or changes tests. Runs the two-edit check for real (break the behaviour and the test must fail; restructure the internals and the test must pass) and reports each test as keep, rewrite or delete, with the command output as evidence.
---

# Reviewing tests

Reading a test tells you what it claims. Only running it against broken code
tells you whether it checks anything. For every test in scope, make two real
edits to the code under test, run the test, and record what happened.

The rules a test is judged against are in the `writing-tests` skill.

## Procedure

1. **Start clean.** Run `git status`. Commit or set aside unrelated changes so
   every edit you make below can be reverted exactly with
   `git checkout -- <file>`. Never revert a file you did not edit.
2. **List the tests in scope:** every test added or changed in the diff
   (`git diff <base> --stat -- '**/*.test.*'`). Run them once and confirm
   they pass. A test that fails before you edit anything is reported as
   broken, not reviewed.
3. **For each test, write down the behaviour it claims** in one sentence,
   and the source lines that implement it.
4. **Edit 1, break it.** Make the smallest source edit that breaks that
   behaviour as a user would see it: a wrong value, a skipped effect, or an
   effect done twice. Rebuild if the test runs `dist/` (CLI harness tests
   do). Run only that test.
   - It must **fail**, and the failure must **show the broken behaviour**
     (the wrong value, the missing or extra request). Copy it into your
     notes. A crash in setup, a timeout, or a failure unrelated to the break
     doesn't count.
   - Revert with `git checkout -- <file>` and rebuild.
   - Try more than one break when the test claims several things (a value
     _and_ an effect); each claim needs a break that only that claim catches.
5. **Edit 2, restructure.** Change the internals without changing anything a
   caller can observe: inline or extract a helper, rename a private function,
   reorder independent statements, swap a loop for `map`. Rebuild and run.
   It must **pass**. Revert and rebuild.
6. **Verdict per test:**
   - **keep:** failed every break, passed the restructure.
   - **rewrite:** survived a break (too loose, wrong layer, asserts its own
     data) or failed the restructure (pinned to the implementation). Say
     what to assert instead.
   - **delete:** there is no behaviour to pin, or a better test already
     covers it.
7. **Finish clean.** `git status` and `git diff` must show only the changes
   you started with. Rebuild one last time so `dist/` matches the source.
8. **Report** using the template in
   [references/report-template.md](references/report-template.md): for each
   test, the break edit as a diff, the failing assertion output, the
   restructure edit, the passing run, and the verdict.

Never commit a break edit. If you fix tests based on the review, rerun the
procedure on the fixed tests.

## References

- [references/break-edits.md](references/break-edits.md): which breaks and
  restructures to try for common kinds of behaviour, with CLI examples.
- [references/report-template.md](references/report-template.md): the
  report format for a PR comment or description.

Adapted in our own words from the testing guidance in Cursor's
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT,
© 2026 Lauren Tan).
