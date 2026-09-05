#!/usr/bin/env bash
set -euo pipefail
# Run from libraries/typescript after checkout and installation.
case "$GITHUB_REF_NAME" in
  main) channel=stable ;;
  canary) channel=canary ;;
  *) echo '::error::Releases require main or canary'; exit 1 ;;
esac

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
echo "channel=$channel" >> "$GITHUB_OUTPUT"

# Stable versioning is reviewable and independent of the merge commit's title.
if [[ "$channel" == stable ]] && { [[ -f .changeset/pre.json ]] || [[ -n "$(node scripts/release-channel.mjs pending)" ]]; }; then
  branch=release/typescript-stable
  existing="$(gh pr list --base main --head "$branch" --state open --json number --jq '.[0].number // empty')"
  if [[ -n "$existing" ]]; then
    echo "Stable version PR #$existing is already open." >> "$GITHUB_STEP_SUMMARY"
    echo 'publish=false' >> "$GITHUB_OUTPUT"
    exit 0
  fi
  pnpm release-channel preflight --channel stable
  # Docs must exist for the projected stable versions before opening the version PR.
  pnpm check:release-docs
  git checkout -b "$branch"
  if [[ -f .changeset/pre.json ]]; then
    pnpm changeset pre exit
    pnpm version:exit-prerelease
  else
    pnpm changeset version
  fi
  pnpm install --lockfile-only --no-frozen-lockfile
  git add .changeset packages pnpm-lock.yaml
  git commit -m 'chore(release): version TypeScript packages for stable release'
  # Do not overwrite an unexpected remote branch. Remove a previously merged
  # release branch before dispatching again if repository auto-delete is off.
  git push origin "HEAD:refs/heads/$branch"
  gh pr create --base main --head "$branch" \
    --title 'release(typescript): version stable packages' \
    --body-file ../../.github/scripts/stable-release-pr.md
  echo 'publish=false' >> "$GITHUB_OUTPUT"
  exit 0
fi

# Retry an interrupted publish before consuming another changeset. Missing git
# tags for already published versions are recovered using npm's original gitHead.
pnpm release-channel snapshot --channel "$channel" --recover-tags "${RECOVER_TAGS:-true}" --output "$RUNNER_TEMP/release-plan.json"
targets="$(node -e 'console.log(require(process.env.RUNNER_TEMP + "/release-plan.json").releases.filter(r => r.target).length)')"
if [[ "$channel" == canary && "$targets" == 0 ]]; then
  if [[ ! -f .changeset/pre.json ]]; then
    pnpm changeset pre enter canary
  fi
  if [[ -n "$(node scripts/release-channel.mjs pending)" ]]; then
    pnpm release-channel preflight --channel canary
    pnpm release-channel prepare --channel canary
    pnpm changeset status --since origin/main --output "$RUNNER_TEMP/changeset-status.json"
    pnpm release-channel validate --channel canary --plan "$RUNNER_TEMP/changeset-status.json"
    pnpm changeset version
    pnpm install --lockfile-only --no-frozen-lockfile
  fi
  git add .changeset packages pnpm-lock.yaml
  if ! git diff --cached --quiet; then
    git commit -m 'chore(typescript): version packages (canary)'
    # A concurrent merge makes this push fail before anything reaches npm.
    git push origin HEAD:refs/heads/canary
  fi
  pnpm release-channel snapshot --channel canary --recover-tags "${RECOVER_TAGS:-true}" --output "$RUNNER_TEMP/release-plan.json"
fi
node --input-type=module <<'JS'
import fs from 'node:fs';
const plan = JSON.parse(fs.readFileSync(`${process.env.RUNNER_TEMP}/release-plan.json`, 'utf8'));
fs.appendFileSync(process.env.GITHUB_OUTPUT, `publish=${plan.releases.some(r => r.target)}\n`);
JS
