# mcp-use

## 1.1.3-canary.0

### Patch Changes

- d171bf7: feat/app-sdk
- Updated dependencies [d171bf7]
  - @mcp-use/inspector@0.4.3-canary.0

## 1.1.2

### Patch Changes

- abb7f52: ## Enhanced MCP Inspector with Auto-Connection and Multi-Server Support

  ### 🚀 New Features
  - **Auto-connection functionality**: Inspector now automatically connects to MCP servers on startup
  - **Multi-server support**: Enhanced support for connecting to multiple MCP servers simultaneously
  - **Client-side chat functionality**: New client-side chat implementation with improved message handling
  - **Resource handling**: Enhanced chat components with proper resource management
  - **Browser integration**: Improved browser-based MCP client with better connection handling

  ### 🔧 Improvements
  - **Streamlined routing**: Refactored server and client routing for better performance
  - **Enhanced connection handling**: Improved auto-connection logic and error handling
  - **Better UI components**: Updated Layout, ChatTab, and ToolsTab components
  - **Dependency updates**: Updated various dependencies for better compatibility

  ### 🐛 Fixes
  - Fixed connection handling in InspectorDashboard
  - Improved error messages in useMcp hook
  - Enhanced Layout component connection handling

  ### 📦 Technical Changes
  - Added new client-side chat hooks and components
  - Implemented shared routing and static file handling
  - Enhanced tool result rendering and display
  - Added browser-specific utilities and stubs
  - Updated Vite configuration for better development experience

- Updated dependencies [abb7f52]
  - @mcp-use/inspector@0.4.2

## 1.1.2-canary.0

### Patch Changes

- d52c050: ## Enhanced MCP Inspector with Auto-Connection and Multi-Server Support

  ### 🚀 New Features
  - **Auto-connection functionality**: Inspector now automatically connects to MCP servers on startup
  - **Multi-server support**: Enhanced support for connecting to multiple MCP servers simultaneously
  - **Client-side chat functionality**: New client-side chat implementation with improved message handling
  - **Resource handling**: Enhanced chat components with proper resource management
  - **Browser integration**: Improved browser-based MCP client with better connection handling

  ### 🔧 Improvements
  - **Streamlined routing**: Refactored server and client routing for better performance
  - **Enhanced connection handling**: Improved auto-connection logic and error handling
  - **Better UI components**: Updated Layout, ChatTab, and ToolsTab components
  - **Dependency updates**: Updated various dependencies for better compatibility

  ### 🐛 Fixes
  - Fixed connection handling in InspectorDashboard
  - Improved error messages in useMcp hook
  - Enhanced Layout component connection handling

  ### 📦 Technical Changes
  - Added new client-side chat hooks and components
  - Implemented shared routing and static file handling
  - Enhanced tool result rendering and display
  - Added browser-specific utilities and stubs
  - Updated Vite configuration for better development experience

- Updated dependencies [d52c050]
  - @mcp-use/inspector@0.4.2-canary.0

## 1.1.1

### Patch Changes

- 3670ed0: minor fixes
- 3670ed0: minor
- Updated dependencies [3670ed0]
- Updated dependencies [3670ed0]
  - @mcp-use/inspector@0.4.1

## 1.1.1-canary.1

### Patch Changes

- a571b5c: minor
- Updated dependencies [a571b5c]
  - @mcp-use/inspector@0.4.1-canary.1

## 1.1.1-canary.0

### Patch Changes

- 4ad9c7f: minor fixes
- Updated dependencies [4ad9c7f]
  - @mcp-use/inspector@0.4.1-canary.0

## 1.1.0

### Minor Changes

- 0f2b7f6: feat: Add OpenAI Apps SDK integration
  - Added new UI resource type for Apps SDK, allowing integration with OpenAI's platform
  - Enhanced MCP-UI adapter to handle Apps SDK metadata and structured content
  - Updated resource URI format to support `ui://widget/` scheme
  - Enhanced tool definition with Apps SDK-specific metadata
  - Ensure `_meta` field is at top level of resource object for Apps SDK compatibility
  - Added comprehensive test suite for Apps SDK resource creation
  - Updated type definitions to reflect new resource capabilities

  refactor: Improve compatibility
  - Renamed `fn` to `cb` in tool and prompt definitions for consistency.
  - Updated resource definitions to use `readCallback` instead of `fn`.
  - Adjusted related documentation and type definitions to reflect these changes.
  - Enhanced clarity in the MCP server's API by standardizing callback naming conventions.

### Patch Changes

- Updated dependencies [0f2b7f6]
  - @mcp-use/inspector@0.4.0

## 1.0.7

### Patch Changes

- fix: update to monorepo
- Updated dependencies
  - @mcp-use/inspector@0.3.11

## 1.0.6

### Patch Changes

- 36722a4: Introduced structured output in MCPAgent.streamEvents method, with polling status updates on structured output progress
  - @mcp-use/inspector@0.3.10

## 1.0.5

### Patch Changes

- 55dfebf: Add MCP-UI Resource Integration

  Add uiResource() method to McpServer for unified widget registration with MCP-UI compatibility.
  - Support three resource types: externalUrl (iframe), rawHtml (direct), remoteDom (scripted)
  - Automatic tool and resource generation with ui\_ prefix and ui://widget/ URIs
  - Props-to-parameters conversion with type safety
  - New uiresource template with examples
  - Inspector integration for UI resource rendering
  - Add @mcp-ui/server dependency
  - Complete test coverage
  - @mcp-use/inspector@0.3.9

## 1.0.4

### Patch Changes

- fix: support multiple clients per server
- Updated dependencies
  - @mcp-use/inspector@0.3.8

## 1.0.3

### Patch Changes

- fix: export server from mcp-use/server due to edge runtime
- Updated dependencies
  - @mcp-use/inspector@0.3.7

## 1.0.2

### Patch Changes

- 3bd613e: Non blocking structured output process
  - @mcp-use/inspector@0.3.6

## 1.0.1

### Patch Changes

- 1310533: add MCP server feature to mcp-use + add mcp-use inspector + add mcp-use cli build and deployment tool + add create-mcp-use-app for scaffolding mcp-use apps
- Updated dependencies [1310533]
  - @mcp-use/inspector@0.3.3

## 1.0.0

### Patch Changes

- Updated dependencies
  - @mcp-use/inspector@0.3.0

## 0.3.0

### Minor Changes

- db54528: Added useMcpTools React hook for easier tool management

  ````

  ## Step 5: Commit Everything

  ```bash
  git add .
  git commit -m "feat: add useMcpTools React hook"
  git push origin feat/add-use-mcp-tools-hook
  ````

  ## Step 6: Create Pull Request

  Create a PR on GitHub with:

  **Title:** `feat: add useMcpTools React hook`

  **Description:**

  ```markdown
  ## What

  Adds a new `useMcpTools()` React hook for managing MCP tools.

  ## Why

  Simplifies tool management in React applications.

  ## Changes

  - Added `useMcpTools` hook in `packages/mcp-use/src/react/hooks/`
  - Exported from `mcp-use/react`
  - Added tests for the new hook

  ## Changeset

  ✅ Changeset included (minor bump for mcp-use)
  ```

  ## Step 7: Review & Merge

  After review and approval:

  ```bash
  # Merge the PR to main
  ```

  ## Step 8: Release (Maintainer Task)

  On the `main` branch after merge:

  ```bash
  # Switch to main and pull
  git checkout main
  git pull origin main

  # Check what will be versioned
  pnpm version:check
  ```

  **Output:**

  ```
  🦋  info Packages to be bumped at minor:
  🦋  - mcp-use (0.2.0 → 0.3.0)
  🦋
  🦋  info Packages to be bumped at patch:
  🦋  - @mcp-use/cli (2.0.1 → 2.0.2) ← depends on mcp-use
  🦋  - @mcp-use/inspector (0.1.0 → 0.1.1) ← depends on mcp-use
  ```

  ```bash
  # Apply the version changes
  pnpm version
  ```

  **This will:**
  1. Update `mcp-use/package.json` to `0.3.0`
  2. Update dependent packages (`@mcp-use/cli`, `@mcp-use/inspector`) with patch bumps
  3. Generate/update `CHANGELOG.md` in each package:

  ```markdown
  # mcp-use

  ## 0.3.0

  ### Minor Changes

  - abc1234: Added useMcpTools React hook for easier tool management

  ## 0.2.0

  ...
  ```

  4. Delete `.changeset/random-name-here.md`
  5. Update `pnpm-lock.yaml`

  ```bash
  # Review the changes
  git diff

  # Commit the version changes
  git add .
  git commit -m "chore: version packages"
  git push origin main
  ```

  ## Step 9: Publish to npm

  ```bash
  # Build everything
  pnpm build

  # Publish to npm
  pnpm release
  ```

  **This will:**
  1. Build all packages with tsup
  2. Run `changeset publish`
  3. Publish `mcp-use@0.3.0` to npm
  4. Publish `@mcp-use/cli@2.0.2` to npm
  5. Publish `@mcp-use/inspector@0.1.1` to npm
  6. Create git tags for each version

  **Output:**

  ```
  🦋  info npm info mcp-use
  🦋  info npm publish mcp-use@0.3.0
  🦋  success packages published successfully:
  🦋  - mcp-use@0.3.0
  🦋  - @mcp-use/cli@2.0.2
  🦋  - @mcp-use/inspector@0.1.1
  ```

  ```bash
  # Push tags
  git push --follow-tags
  ```

  ## Step 10: Verify Publication

  ```bash
  # Check on npm
  npm view mcp-use version
  # Output: 0.3.0

  npm view @mcp-use/cli version
  # Output: 2.0.2

  # Or visit:
  # https://www.npmjs.com/package/mcp-use
  # https://www.npmjs.com/package/@mcp-use/cli
  # https://www.npmjs.com/package/@mcp-use/inspector
  # https://www.npmjs.com/package/create-mcp-use-app
  ```

  ## 📊 Timeline Summary
  1. **Day 1**: Developer creates feature + changeset, pushes PR
  2. **Day 2-3**: Code review, changes, approval
  3. **Day 3**: PR merged to main
  4. **Day 3**: Maintainer runs `pnpm version` → Version PR created
  5. **Day 3**: Maintainer reviews and merges Version PR
  6. **Day 3**: Automated workflow publishes to npm
  7. **Done!** ✨

  ## 🤖 Automated Workflow (GitHub Actions)

  With the included GitHub Actions workflows:
  1. **Developer** creates PR with changeset
  2. **CI** validates build, tests, lint
  3. **Merge** to main triggers release workflow
  4. **Changesets Action** creates "Version Packages" PR automatically
  5. **Maintainer** reviews and merges Version PR
  6. **Action** automatically publishes to npm
  7. **Done!** No manual commands needed

  ## 🎓 Learning Resources
  - **Quick Reference**: See `CHANGESET_WORKFLOW.md`
  - **Detailed Guide**: See `VERSIONING.md`
  - **Changesets Docs**: https://github.com/changesets/changesets
  - **Semantic Versioning**: https://semver.org/

  ## 💡 Tips
  - **Batch related changes** - Create one changeset for related changes across packages
  - **Clear summaries** - Write what users need to know, not implementation details
  - **Link to PRs** - Reference PR numbers in changeset summaries
  - **Test before release** - Always build and test before publishing
  - **Coordinate major bumps** - Plan breaking changes with the team

  ***

  **Ready to get started?**

  ```bash
  # Make some changes, then:
  pnpm changeset
  ```

### Patch Changes

- db54528: Migrated build system from tsc to tsup for faster builds (10-100x improvement) with dual CJS/ESM output support. This is an internal change that improves build performance without affecting the public API.
- Updated dependencies [db54528]
  - @mcp-use/inspector@0.2.1
