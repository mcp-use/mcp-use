Versions TypeScript packages for publication to npm's `latest` channel and updates the lockfile and changelogs.

Merging this PR starts TypeScript Release. It builds and verifies the final versions, publishes their tarballs, and verifies npm before creating tags and GitHub releases.

After the stable release succeeds, merge main back into canary before starting the next canary release. The release workflow preserves canary's commits.
