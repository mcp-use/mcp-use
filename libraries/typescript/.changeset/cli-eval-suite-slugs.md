---
"@mcp-use/cli": minor
---

**Breaking:** eval suite files need a top-level `id`: the suite's slug, its ID within the server (lowercase letters and digits in groups joined by single hyphens, at most 64 characters). It is never derived from `name`, so a file without one fails, and the error suggests one made from the name. `evals push` now matches files to suites by `id` instead of by name: it updates the suite with that slug, or creates one with it, and prints `Created` or `Updated` per file, so renaming a suite in its file keeps the same suite. Two files with the same `id` fail the push with `eval_suite_duplicate_id` before anything is sent. `evals create` refuses an `id` a suite already has (`eval_suite_exists`), `evals update --file` sets the suite's slug to the file's `id`, and a slug another suite holds fails with `eval_suite_id_taken`.

A suite ID is now the suite's UUID or its slug wherever a suite is selected: `evals get`, `export`, `update`, `rm`, `run` and `runs --suite`. A UUID match wins over a slug. Names and file paths are still rejected with `eval_suite_not_found`.

`evals export` writes `id: <slug>` first, and `--out` with a directory writes `<slug>.yaml` inside it. `evals list` and `get --json` add `slug` next to `id` (the UUID); `create`, `update` and `rm` print and return both.

Suite IDs need a Manufact Cloud that returns suite slugs. Against an older one, selecting suites by UUID still works, and `push` (and a `create` or `update` whose response has no slug) fails with `eval_suite_ids_unsupported` rather than creating duplicates.
