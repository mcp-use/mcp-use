# Pull Request Description

## Language / Project Scope

Check all that apply:
- [ ] TypeScript
- [ ] Python
- [ ] Documentation only
- [ ] CI/CD or tooling

## Changes

Describe the changes introduced by this PR in a concise manner.

## Review Readiness

Help maintainers review this quickly:

- [ ] The PR is scoped to one issue or one clearly related change
- [ ] The PR description explains the user-visible problem and the fix
- [ ] The diff avoids unrelated formatting, generated files, and bulk rewrites
- [ ] I verified the affected package/docs path with the commands listed below
- [ ] I checked for existing open PRs that already solve the same issue

## Implementation Details

1. List the specific implementation details
2. Include code organization, architectural decisions
3. Note any dependencies that were added or modified

---

## TypeScript Checklist

> Complete this section if your PR includes TypeScript changes

### Packages Modified

Check all packages that were modified:
- [ ] `docs`
- [ ] `tests`
- [ ] `cli`
- [ ] `create-mcp-use-app`
- [ ] `mcp-use` (server)
- [ ] `mcp-use` (client)
- [ ] `inspector`

### Pre-commit Checklist

Ensure all of the following have been completed:
- [ ] Ran `pnpm lint:fix` to auto-fix linting issues
- [ ] Ran `pnpm format` to format code with Prettier
- [ ] Ran `pnpm build` and build succeeds without errors
- [ ] Ran `pnpm changeset` to create a changeset (if this PR includes user-facing changes)
- [ ] Added or updated tests if needed
- [ ] Updated documentation in `docs/` folder if needed

---

## Python Checklist

> Complete this section if your PR includes Python changes

### Pre-commit Checklist

Ensure all of the following have been completed:
- [ ] Code formatted with `ruff format`
- [ ] Linting passes with `ruff check`
- [ ] Added or updated tests if needed
- [ ] Updated documentation if needed

---

## Example Usage (Before)

```
# Include example code showing how things worked before (if applicable)
# Use the appropriate language syntax (python, typescript, bash, etc.)
```

## Example Usage (After)

```
# Include example code showing how things work after your changes
# Use the appropriate language syntax (python, typescript, bash, etc.)
```

## Documentation Updates

* List any documentation files that were updated
* Explain what was changed in each file

## Testing

Describe how you tested these changes:
- Unit tests added/modified
- Integration tests added/modified
- Manual testing performed
- Edge cases considered

## Backwards Compatibility

Explain whether these changes are backwards compatible. If not, describe what users will need to do to adapt to these changes.

## Related Issues

Closes #[issue_number]
