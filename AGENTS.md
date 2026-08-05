# thinkchainai/mcp-use — Agent Context

Org fork of [mcp-use/mcp-use](https://github.com/mcp-use/mcp-use) for MCPBundles Connect Auth upstream work.

Submodule path in MCPBundles monorepo: `public_github_repos/mcp-use`.

**Execution checklist:** parent repo `product/mcp-connect-auth/coding-plan.md` § P7c.  
**Implementation plan:** `product/mcp-connect-auth/log/2026-08-05-p7c-mcp-use-plan.md`

## Remotes

| Remote | URL | Use |
|--------|-----|-----|
| `origin` | `https://github.com/thinkchainai/mcp-use.git` | Push feature branches; open PRs to mcp-use |
| `upstream` | `https://github.com/mcp-use/mcp-use.git` | Sync before new work |

```bash
git fetch upstream
git checkout main
git merge upstream/main   # or rebase feature branch onto upstream/main
```

## Target integration

TypeScript **resource-server** OAuth provider for MCP Connect Auth — mirror WorkOS/Auth0 providers:

- `libraries/typescript/packages/server/src/oauth/mcpbundles.ts` — `oauthMcpbundlesProvider()` **implemented locally**
- Tests in `libraries/typescript/packages/server/tests/oauth-direct-providers.test.ts`
- Example: `libraries/typescript/packages/server/examples/auth/mcpbundles/`
- Docs: `docs/typescript/.../mcpbundles.mdx` + `docs/v2/.../mcpbundles.mdx`
- Changeset: `libraries/typescript/.changeset/mcpbundles-oauth-provider.md`

Port JWT verify + `public-config` fetch from `@mcpbundles/mcp-connect-auth` (parent submodule `public_github_repos/mcp-connect-auth-js`).

## Workflow

1. Branch: `mcpbundles-connect-provider` (created).
2. Implement provider + tests + docs + example.
3. `cd libraries/typescript && pnpm install && pnpm build && pnpm changeset`
4. Push to **`origin`**; open PR **`mcp-use/mcp-use`** from `thinkchainai/mcp-use:<branch>`.
5. Parent monorepo bumps submodule SHA on `main` while PR is open.

## Rules

- Follow existing `oauthWorkOSProvider` / `oauthCustomProvider` patterns — DCR-direct flow, JWKS verify.
- No secrets in examples; federation secret stays on vendor web app only.
- Integration doc link: `https://www.mcpbundles.com/docs/integrations/mcp-connect-auth`
