# TypeScript v1 patch releases

The `v1` branch maintains the legacy TypeScript SDK. For example, a patch
changeset applied to `mcp-use@1.34.6` schedules `1.34.7`.
The v2 SDK is released from `main`/`canary` independently.

## Prepare a fix

1. Branch from `v1` and open the fix PR against **`v1`**.
2. Add a Changesets file under `libraries/typescript/.changeset/` with
   `"mcp-use": patch`. Add other packages only when their code changes.
3. Run the affected tests, build, and `pnpm changeset status --since=origin/v1`
   from `libraries/typescript`. Review any dependent-package bumps in the plan.
4. Merge the reviewed fix PR. Do not manually bump package versions in that PR.

Use patch changesets for compatible maintenance fixes. Major or minor changes
need an explicit compatibility decision; the publisher's major-line allowlist
does not itself enforce patch-only bumps.

## Version and publish

The `Release v1 maintenance` job in `.github/workflows/typescript-release.yml`
runs on pushes to `v1` affecting the TypeScript tree or that workflow:

1. It installs with the frozen lockfile, builds the workspace, and runs
   Changesets to create/update **`chore(release-v1): version packages`**.
2. Review and merge that separate version PR. Check package versions,
   changelogs, lockfile changes, and any dependent-package releases.
3. The next run invokes `scripts/v1-release.mjs plan` and `publish` once there
   are no pending changesets. It publishes the packages changed by the latest
   v1 version commit using npm trusted publishing and provenance.
4. Publication uses **`legacy-v1`**, verifies the published version and tag,
   checks that other npm tags did not change, and pushes package Git tags.

The allowed package lines are `mcp-use@1.x`, `@mcp-use/cli@3.x`,
`@mcp-use/inspector@12.x`, and `create-mcp-use-app@0.14.x`.
For this session-cleanup changeset, Changesets plans `mcp-use@1.34.7`,
`@mcp-use/cli@3.6.8`, and `@mcp-use/inspector@12.0.7`. The CLI also fixes
maintenance-channel update notices; the Inspector bump propagates dependencies.
The script rejects prerelease mode and a GitHub ref other than `v1`.
It skips already published versions when resuming an interrupted release.
GitHub Releases are not created by this maintenance job.

If a run fails, inspect the registry and job logs, then rerun the existing job
or dispatch `TypeScript Release` on **`v1`**. The v1 job does not use the
workflow's `force_publish` input; it plans from the latest v1 version commit.
Do not bypass this job with the monorepo's generic `pnpm release` or the
package's `npm version` scripts.

## Verify and consume

After publication, check:

```sh
npm view mcp-use@1.34.7 version dist.tarball --json
npm view mcp-use dist-tags --json
```

Expect `legacy-v1` to point to the new 1.x release and `latest` to remain on
the current v2 release. Inspect the published artifact and test a clean v1
consumer before upgrading customer deployments. Source tests passing and npm
publication are separate from validation under the deployed workload.

Customers can install the maintenance channel or pin the verified release:

```sh
npm install mcp-use@legacy-v1
# Once this patch is published:
npm install mcp-use@1.34.7
```

An existing `^1.x` range can resolve a new 1.x patch when its lockfile is
updated. An exact version or unchanged lockfile requires an explicit update
and rebuild. Installing `mcp-use@latest` selects v2 and requires migration.
The patched v1 CLI checks `legacy-v1` for installed v1 projects and recommends
that channel in interactive update notices. Notices are suppressed in piped
output, and caches from other channels or older untagged caches are refreshed.
