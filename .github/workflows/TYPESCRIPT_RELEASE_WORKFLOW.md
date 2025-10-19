# Release Workflow Guide

## Overview

This document explains how the beta and stable release workflows work for the TypeScript monorepo.

## Workflow Strategy: Incremental Beta Releases

We use **incremental prerelease versions** for beta testing (e.g., `1.0.0-beta.0`, `1.0.0-beta.1`, `1.0.0-beta.2`). The workflow:

1. **Commits `.changeset/pre.json`** to beta branch (tracks incrementing beta numbers)
2. **Versions and publishes** beta releases to npm
3. **Restores changesets** via selective git checkout (preserves them for main branch)
4. **Resets package.json versions** (keeps beta branch clean)

### Quick Visual Flow

```
Beta Branch Workflow:
┌─────────────────┐
│ Create          │
│ changesets      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Enter prerelease│────▶│ Commit pre.json  │
│ mode (once)     │     │ to beta branch   │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│ Version         │────▶│ Publish to npm   │
│ (beta.0, .1..)  │     │ with @beta tag   │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│ Restore         │────▶│ ✅ Changesets    │
│ changesets &    │     │ preserved!       │
│ package.json    │     │ Beta # tracked!  │
└─────────────────┘     └──────────────────┘

Main Branch Workflow (after merge):
┌─────────────────┐     ┌──────────────────┐
│ Exit prerelease │────▶│ Version packages │
│ mode            │     │ (stable: 1.0.0)  │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│ Publish to npm  │────▶│ Create git tags  │
│ with @latest    │     │ & commit         │
└─────────────────┘     └──────────────────┘
```

### References

- [Changesets Snapshot Releases Documentation](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md)
- [Changesets Prereleases Documentation](https://github.com/changesets/changesets/blob/main/docs/prereleases.md)

---

## Beta Release Workflow (beta branch)

**File:** `.github/workflows/typescript-release-beta.yml`

### What Happens:

1. **Triggers**: Push to `beta` branch with changes in `libraries/typescript/**`
2. **Check for changesets**: Looks for changeset files in `.changeset/`
3. **Enter prerelease mode** (if not already):
   - Runs `pnpm changeset pre enter beta` (only if `.changeset/pre.json` doesn't exist)
   - Creates `.changeset/pre.json` to track beta state
4. **Commit prerelease state**:
   - Commits `.changeset/pre.json` to beta branch
   - This file tracks incrementing beta numbers across pushes
5. **Version packages**:
   - Runs `pnpm run version` (which runs `changeset version`)
   - Creates incremental beta versions: `1.0.0-beta.0`, `1.0.0-beta.1`, `1.0.0-beta.2`, etc.
   - Temporarily consumes changesets and updates package.json files
6. **Publish**: Publishes to npm with `beta` tag using `pnpm release:beta`
7. **Restore changesets**:
   - Runs `git checkout HEAD -- .changeset/*.md` to restore changeset files
   - Resets `package.json` and `CHANGELOG.md` to previous state
   - **Keeps** `.changeset/pre.json` committed (for incrementing beta numbers)
   - **Restores** changesets so they remain for main branch

### Key Features:

✅ **Truly incremental beta versions** - `beta.0` → `beta.1` → `beta.2` across pushes  
✅ **Changesets preserved** - restored after each publish, available for main branch  
✅ **Prerelease state persists** - `.changeset/pre.json` tracked in beta branch  
✅ **Package versions reset** - beta branch doesn't accumulate version bumps  
✅ **Users install with**: `npm install mcp-use@beta`

### Example Version Progression:

```
Push 1 (with changesets): mcp-use@1.0.0-beta.0
Push 2 (same changesets):  mcp-use@1.0.0-beta.1  ← Increments!
Push 3 (same changesets):  mcp-use@1.0.0-beta.2  ← Keeps incrementing!
Push 4 (add new minor changeset): mcp-use@1.1.0-beta.0  ← Resets for new version
Push 5 (same changesets):  mcp-use@1.1.0-beta.1  ← Increments again!
```

**Note**: Beta numbers increment across pushes because `.changeset/pre.json` is committed and tracks state. The base version (e.g., `1.0.0` vs `1.1.0`) is determined by the changesets.

---

## Stable Release Workflow (main branch)

**File:** `.github/workflows/typescript-release.yml`

### What Happens:

1. **Triggers**: Push to `main` branch (typically from merging beta)
2. **Check for changesets**: Looks for changeset files in `.changeset/`
3. **Exit prerelease mode** (if needed):
   - Checks for `.changeset/pre.json` file
   - Runs `pnpm changeset pre exit` if found
   - Removes prerelease state
4. **Version packages**:
   - Runs `pnpm run version` (which runs `changeset version`)
   - Creates stable versions: `1.0.0`, `1.1.0`, `2.0.0`, etc.
   - **Consumes changesets** (changeset files are deleted)
   - Updates `CHANGELOG.md` files
   - Updates `package.json` versions
5. **Commit**: Commits version changes with message `"chore(typescript): version packages"`
6. **Publish**: Publishes to npm with `latest` tag (default) using `pnpm release`
7. **Tags**: Creates git tags for each package version

### Key Features:

✅ **Changesets consumed** - changeset files deleted after versioning  
✅ **Git commits created** - version bumps and changelogs committed  
✅ **Git tags created** - for each package version  
✅ **Users install with**: `npm install mcp-use` (gets latest stable)

---

## Merging Beta to Main

### Before Merge Checklist:

1. ✅ **Test beta releases thoroughly** - `npm install mcp-use@beta`
2. ✅ **Verify changesets exist** - Check `.changeset/` directory has `.md` files
3. ✅ **Review changeset content** - Ensure descriptions are clear and accurate
4. ✅ **Check versions in beta** - Beta versions (e.g., `1.0.0-beta.0`) should be published to npm

### What Happens After Merge:

When you merge `beta` → `main`:

1. **GitHub Actions triggers** the stable release workflow
2. **Changesets are still present** (because beta restored them after each publish)
3. **`.changeset/pre.json` exists** in beta branch (will be merged to main)
4. **Prerelease mode is exited**:
   - Workflow detects `.changeset/pre.json` file
   - Runs `pnpm changeset pre exit` to remove prerelease state
5. **Workflow processes changesets**:
   - Reads all changeset files
   - Calculates version bumps (patch/minor/major)
   - Updates package.json versions to stable versions (e.g., `1.1.0` not `1.1.0-beta.2`)
   - Generates CHANGELOG entries
   - Deletes changeset files and pre.json
6. **Creates commit** with all version changes
7. **Publishes to npm** with `latest` tag
8. **Creates git tags** for releases

### Expected Results:

✅ **Changelogs updated** with all changes from changesets  
✅ **Package versions bumped** according to changeset types  
✅ **npm packages published** with `latest` tag  
✅ **Git tags created** (e.g., `mcp-use@1.1.0`, `@mcp-use/cli@2.1.13`)  
✅ **Changesets deleted** from `.changeset/`

---

## NPM Package Scripts

**File:** `libraries/typescript/package.json`

### Available Commands:

```json
{
  "changeset": "changeset", // Create a new changeset
  "version": "changeset version && pnpm install --no-frozen-lockfile", // Version packages (stable)
  "release": "pnpm build && changeset publish", // Publish stable release
  "release:beta": "pnpm build && changeset publish --tag beta" // Publish beta release
}
```

### Manual Testing:

```bash
cd libraries/typescript

# Create a changeset
pnpm changeset

# Test snapshot versioning (doesn't consume changesets)
pnpm changeset version --snapshot beta

# Test stable versioning (consumes changesets)
pnpm run version
```

---

## Troubleshooting

### Issue: "No changesets found" when merging to main

**Cause**: Changesets were consumed in beta (old workflow without git reset)  
**Solution**: The workflow now resets git state after publishing to preserve changesets.

### Issue: Beta versions not published

**Cause**: No changesets exist in `.changeset/`  
**Solution**: Create changesets with `pnpm changeset` before pushing to beta

### Issue: Wrong npm tag (beta published as latest)

**Cause**: Missing `--tag beta` flag  
**Solution**: Use `pnpm release:beta` which includes the correct tag

### Issue: Git conflicts when merging beta to main

**Cause**: Beta workflow resets git after publishing (no commits to beta)  
**Solution**: Merge should be clean. Main workflow will create the version commit.

---

## Comparison: Old vs New Workflow

### Old Workflow (Prerelease Mode without Git Reset)

```bash
# Beta branch
→ changeset pre enter beta     # Enter prerelease mode
→ changeset version             # Creates 1.0.0-beta.0, CONSUMES changesets
→ changeset publish --tag beta  # Publish
→ git commit & push             # Commit version changes (changesets deleted)

# Main branch (after merge)
→ changeset pre exit            # Exit prerelease mode
→ changeset version             # ❌ NO CHANGESETS LEFT!
→ changeset publish             # Nothing to publish
```

**Problem**: Changesets consumed and committed in beta, nothing left for main.

### New Workflow (Prerelease Mode with Selective Git Restore)

```bash
# Beta branch
→ changeset pre enter beta                # Enter prerelease mode (first time only)
→ git commit & push pre.json              # Commit prerelease state
→ changeset version                       # Creates 1.0.0-beta.0, beta.1, beta.2, etc.
→ changeset publish --tag beta            # Publish to npm
→ git checkout HEAD -- .changeset/*.md    # ✅ Restore changeset files!
→ git checkout HEAD -- package.json       # ✅ Reset package versions!
→ pre.json remains committed              # ✅ Tracks beta numbers across pushes!

# Main branch (after merge)
→ changeset pre exit                      # Exit prerelease mode (pre.json merged from beta)
→ changeset version                       # ✅ Changesets still exist!
→ changeset publish                       # Creates stable 1.0.0
→ git commit & push                       # Commit stable version (removes pre.json)
→ git tag                                 # Tag release
```

**Solution**:

- ✅ Changesets preserved via selective git restore
- ✅ Truly incremental beta versions (.0 → .1 → .2) via committed pre.json
- ✅ Stable release works correctly when merging to main

---

## Best Practices

1. **Always create changesets** before pushing to beta
2. **Test beta releases** before merging to main
3. **Use semantic versioning** in changesets (patch/minor/major)
4. **Write clear changeset descriptions** - they become changelog entries
5. **Keep beta branch clean** - don't commit version bumps manually (workflow handles this)
6. **Let workflows handle releases** - avoid manual npm publish
7. **After stable release**: Sync beta branch with main to remove `.changeset/pre.json`

### Syncing Beta After Stable Release

After a stable release on main, sync your beta branch:

```bash
# After merging beta → main and stable release is complete
git checkout beta
git merge main  # This removes pre.json that was deleted in stable release
git push
```

This ensures the next beta cycle starts fresh with `beta.0`.

---

## References

- [Changesets GitHub](https://github.com/changesets/changesets)
- [Changesets Documentation](https://github.com/changesets/changesets/tree/main/docs)
- [Snapshot Releases](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md)
- [Prereleases](https://github.com/changesets/changesets/blob/main/docs/prereleases.md)

---

**Last Updated**: January 19, 2025
