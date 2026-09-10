# Automatic release propagation

Write a changeset for the package you changed. The release preparation step uses
Changesets' version planner to add the other published artifacts that must move.

`release-propagation.mjs` declares bundled build inputs separately from npm
dependencies: Inspector embeds Agent and Client, and CLI embeds Tunnel. A release
of a build input schedules a patch of its bundle owner. This does not add runtime
dependencies or change Inspector's standalone installation size.

Preparation also reconciles internal peer ranges against planned versions. Every
package whose peer metadata changes receives a release. Changesets then propagates
normal package dependencies, including mcp-use's exact Inspector dependency. The
calculation repeats until both the release set and compatibility ranges agree.
Explicit minor/major changesets retain their priority. Compatibility with a new
upstream major must be declared explicitly; the script cannot infer it.

Generated `propagated-*.md` changesets have deterministic IDs based on the pending
user changesets, so retries are idempotent. Applied prerelease changesets do not
trigger another bundle rebuild. The same preparation runs when exiting Canary
for stable release and through `pnpm version`.

Before publication, `release-channel snapshot` packs the packages and checks their
actual internal metadata against the registry. Changed metadata under an already
published version is an error. All peer ranges must accept the exact versions in
the release set using normal npm prerelease semantics. Registry verification
checks the same metadata after publication, in addition to package files and tags.

When adding a package that embeds workspace code, add its build inputs to
`bundledInputs` and a regression case in `release-propagation.test.mjs`. Do not add
runtime dependencies just to influence release selection.
