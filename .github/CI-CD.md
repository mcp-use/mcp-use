# TypeScript CI and releases

Ordinary PRs get one TypeScript check job: install, PR changeset validation, build, formatting, lint, unused-dependency checks, release-tool tests, and package tests. The package tests include server and CLI type checks. These jobs receive no AI API credentials.

Expensive compatibility checks and preview publishing are separate. Python CI and Python release behavior are unchanged.

## Choose a workflow

| Workflow                           | Automatic trigger                                                   | Manual use                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ci.yml` → `typescript-ci.yml`     | Relevant PRs and pushes to `main` or `canary`                       | Run **TypeScript checks** on a selected branch                                                   |
| `typescript-platform.yml`          | TypeScript pushes to `main` or `canary`                             | CLI compatibility on Linux/Node 22 and Windows/Node 24                                           |
| `typescript-scaffold.yml`          | None                                                                | Generator compatibility: 30 OS/package-manager/template combinations                             |
| `server-examples.yml`              | Relevant pushes to `main` or `canary`                               | Build and exercise server examples                                                               |
| `conformance.yml` — TypeScript job | Relevant pushes to `main` or `canary`                               | Set `typescript_only=true`; Python triggers are unchanged                                        |
| `inspector-e2e.yml`                | None                                                                | Select `mix`, `prod`, `builtin`, or all modes                                                    |
| `inspector-e2e-sequential.yml`     | None                                                                | Sequential browser tests with paid OpenAI credentials, on `main` or `canary`                     |
| `typescript-integration.yml`       | None                                                                | Paid native OpenAI integration on `main` or `canary`                                             |
| `typescript-pr-preview.yml`        | Updates to a same-repository PR labeled `ci:preview`                | Add the label to publish preview packages and run Deno checks; remove it to stop future previews |
| `sdk-evals.yml`                    | Monday, Wednesday, Friday at 14:00 UTC                              | Select evaluation tasks and trials; uses paid OpenAI calls                                       |
| `sdk-evals-synthesis.yml`          | Sunday at 13:00 UTC                                                 | Summarize evaluation history; uses paid OpenAI calls                                             |
| `claude.yml`                       | A maintainer posts `@claude` in an issue or PR conversation comment | Inline review comments and review submissions do not invoke Claude                               |
| `typescript-release.yml`           | TypeScript/release-tooling pushes to `main` or `canary`             | Retry or inspect a release on either branch                                                      |
| `create-app-e2e-canary.yml`        | A successful canary release with a verified marker                  | Test the current canary SDK using the stable scaffolder                                          |
| `publish-inspector-docker.yml`     | A verified stable Inspector release                                 | Republish the current stable npm Inspector image                                                 |
| `railway-deploy.yml`               | A release with a verified marker                                    | Deploy `main` or `canary`                                                                        |

Create the `ci:preview` repository label once during rollout if it does not already exist.

A workflow dispatch means **Actions → workflow name → Run workflow → branch**. A label remains active across PR updates. Preview publishing requires a same-repository branch because it needs write permissions; fork PRs still receive the credential-free checks.

The normal checks use Node 24 and pnpm 11.13.1. Installs use the committed lockfile. Version preparation is the only release stage allowed to refresh that lockfile. The platform workflow retains Node 22 compatibility coverage.

## Add PR changesets

TypeScript PRs targeting **main and canary** run **Check PR changesets** before the build. The check runs `pnpm exec changeset status --since <PR-base-SHA>` and fails when a package changed without a changeset in that PR. An older changeset already on the base branch does not satisfy the check. Maintainer-approved fork runs receive the original PR base SHA too.

From `libraries/typescript`, run `pnpm changeset` and commit the generated file. For a package change that intentionally needs no release, such as tests or internal tooling, commit `pnpm changeset --empty`. Documentation and CI changes outside the packages do not need a package release.

The trusted canary-to-main promotion is exempt from needing an extra changeset when its prerelease changesets are already applied. The stable version PR created by `github-actions[bot]` also needs no extra changeset. Both still run the release docs check. These exceptions do not apply to an ordinary PR or a fork whose branch happens to use the same name.

## Prepare docs before stable promotion

Before merging **canary into main**, prepare the release notes on canary:

- Update `docs/typescript/changelog/changelog.mdx` for the SDK, client, agent, CLI, tunnel, and scaffolder. Its release label uses the projected stable `mcp-use` version.
- Update `docs/inspector/changelog.mdx` for Inspector changes. Its label uses the projected stable `@mcp-use/inspector` version.
- Prepend one matching `<Update label="vX.Y.Z">` entry with release-note bullets. Strip the `-canary.N` suffix. Already-published notes with only whitespace changes, commented examples, duplicate entries, and empty headings do not satisfy promotion.

The check calculates projected versions without changing manifests. It runs before the build on the promotion PR, before the stable version PR is created, on the bot's version PR, and before stable artifacts are built or published. The bot's version PR can inherit notes already reviewed during promotion. Only affected changelog audiences are required. Canary prerelease publication continues without this stable-release gate.

To check a promotion locally, run `pnpm check:release-docs --base <main-commit-SHA>` from `libraries/typescript`. Maintainers must still review the content for accuracy: CI validates versions, placement, and nonempty changed entries, not whether the prose describes every change.

## Release canary packages

1. Merge a PR with changesets into `canary`.
2. TypeScript Release acquires a repository-wide release lock and checks out the branch once.
3. It recovers missing npm versions or unpushed tags before consuming new changesets. Otherwise, it enters prerelease mode, validates the canary plan, versions packages, and updates the lockfile.
4. It pushes the version commit with a normal fast-forward push. A concurrent merge causes the push to fail before publication.
5. It builds and tests the final versions, packs every public package, and checks every declared entry point. Packing suppresses lifecycle hooks and records the Git revision in the tarball.
6. The installation smoke test uses those same tarballs. Publishing sends them to npm sequentially, with runtime dependencies first and an explicit `canary` tag.
7. Registry verification checks versions, tarball contents, integrity for new publications, and channel tags. It rejects changes to unrelated tags.
8. Only verified packages receive Git tags and GitHub releases. A regular, non-hidden marker records the source revision and exact SDK/scaffolder versions for downstream workflows.

Publication runs through GitHub Actions; the old direct `pnpm release` publishing alias is removed.

The workflow filename stays `typescript-release.yml` because npm trusted publishing is configured against that filename. The job uses OIDC and npm 12.0.2; it does not need an npm token.

Both channels share a concurrency group with `cancel-in-progress: false` and `queue: max`. GitHub's [expanded concurrency queue](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/) prevents one pending channel from replacing the other. Actionlint 1.7.12 does not yet recognize `queue`; suppress only that specific diagnostic when validating this workflow.

## Promote a stable release

1. Prepare the docs changelog on canary, then merge `canary` into `main` after release-readiness and compatibility checks pass.
2. The release workflow opens one `release/typescript-stable` PR to exit prerelease mode, update versions and changelogs, and refresh the lockfile. If that PR is already open, it reports the existing PR.
3. Review and merge the version PR. Its commit title does not control whether publication runs.
4. The workflow follows the same build, test, pack, install, publish, and verification sequence, using npm's `latest` channel.
5. After stable publication succeeds, merge `main` back into `canary` before the next release cycle. Resolve conflicts through the normal PR process.

The workflow never force-resets canary. Its commits survive stable publication. If automatic deletion of merged branches is disabled, delete the merged `release/typescript-stable` branch before preparing the next stable release. Bot-created PRs may need a manual check run because GitHub suppresses most events created with `GITHUB_TOKEN`.

## Recover a release

Open the failed run and inspect **Save release plan and tarballs for diagnosis**. Artifacts are retained for 14 days. Do not delete an npm version to try to reuse it: npm versions are immutable.

- **Build or test failed:** fix the cause before publishing. No npm upload has started.
- **A version commit was pushed, but npm is incomplete:** run TypeScript Release on the same branch. Registry discovery still runs when no changesets remain. Already published versions are skipped; missing versions are published and verified.
- **Recovery found pending new changesets:** it finishes the previous publication first. Run the workflow again to consume the pending changesets.
- **npm has a package but its Git tag is missing:** the workflow uses npm's original `gitHead` to recover the tag. It fails rather than guessing if source attribution is absent.
- **npm has an invalid tarball:** add a new patch changeset and publish a new version. An existing version cannot be repaired in place.
- **A GitHub release or downstream deployment failed after tags were pushed:** run TypeScript Release with `repair_metadata=true`, or dispatch the downstream workflow. Do not republish packages merely to repeat a notification or deployment.
- **The canary baseline is below npm `latest`:** merge the stable version changes from `main` into `canary`, resolve version conflicts, and rerun. Do not bypass the version-regression check.

Recovery must precede further package changes on the affected release branch. The publisher refuses an unpublished version if package source changed after its version commit. In that case, recover the saved artifacts separately or commit fresh package versions before retrying. Publishing is serialized, but human merges are not locked. Saved tarballs are diagnostic artifacts; the default retry rebuilds the checked-out version before verification.

## Validate a pipeline change

From `libraries/typescript`, run:

```sh
pnpm install --frozen-lockfile
pnpm test:release-channel
pnpm build
pnpm test:ci
```

The release tests exercise missing packages, unexpected dist-tag changes, tarball integrity mismatch, dependency ordering, interrupted publication, source attribution, and a destructive client `prepack` hook. The packing test uses local tarballs and does not publish.

For workflow syntax, run actionlint on changed workflows. With actionlint 1.7.12, add `-ignore 'unexpected key "queue" for "concurrency"'`. Keep Python-specific diagnostics separate from this TypeScript migration.

## Other workflows

`docs.yml` generates both Python and TypeScript API documentation and validates links. It remains separate because its Python generation is outside this migration. `sync-inspector.yml` mirrors Inspector source to its repository; it does not publish npm packages. `bump-mcp-use-reusable.yml` is a reusable version helper. The Dependabot changeset, PR labeler, issue labeler, stale-issue, link-check, and notification-test workflows serve repository maintenance rather than TypeScript validation.

See [the audit findings](CI-CD-AUDIT.md) for the reasons behind the changes and rollout checks.
