# MCP Client documentation checklist

Updated July 24, 2026.

Progress: **13 of 13 pages ready**

- Ready: 13
- Full v1 migrations: 0
- Targeted corrections completed: 8

## Execution guidance

Treat the documentation in this directory as the current product documentation.
Write from the perspective of how MCP Client works now, not from the perspective
of a migration from an older release.

- Do not call the product, API, feature set, or documentation "v2" in normal
  user-facing content.
- Use version labels such as "v1" and "v2" only when a version distinction is
  required for protocol compatibility, the dedicated migration guide, or a
  temporary beta-period instruction.
- Use stable, tagless install commands unless documenting a specific historical
  prerelease.
- Describe current names and behavior directly. Do not frame them as "new,"
  "renamed," or replacements for old concepts outside the migration guide.
- Use MCP Apps and Views terminology. Do not present widgets or deprecated
  compatibility hooks as the current model.
- Keep the dedicated migration guide task-oriented and self-contained. That page
  is the exception where old and current APIs may be compared explicitly.
- Edit only the current documentation under `docs/v2/typescript`. Do not modify
  the frozen documentation under `docs/typescript`.
- Verify every claim against the current package exports, public types, source,
  CLI help, and maintained examples. Do not make the implementation match stale
  prose as part of this documentation task.
- Type-check or run every TypeScript and TSX example that can be exercised
  locally. Run `mint validate`, `mint broken-links`, and `git diff --check`
  before marking the checklist complete.
- If the implementation and intended public behavior disagree, document the
  evidence and stop on that item instead of inventing an API or silently changing
  product behavior.

## Ready

- [x] [Tools](/v2/typescript/client/tools)
- [x] [Elicitation](/v2/typescript/client/elicitation)
- [x] [Completions](/v2/typescript/client/completion)
- [x] [React integration](/v2/typescript/client/usemcp)
- [x] [Code Mode guide](/v2/typescript/client/code-mode)

## Targeted corrections

- [x] [MCP Client overview](/v2/typescript/client/index)
  - [x] Change the Node.js requirement from 20+ to `>=22.22.2`.
  - [x] Use the stable `@mcp-use/client` install command.
  - [x] Replace widget-first terminology with MCP Apps and Views terminology.
  - [x] Describe `mcp-use/react` through its current View hooks, such as
        `useToolContext`, `useCallTool`, and `useViewState`, rather than deprecated
        widget compatibility hooks.
  - [x] Keep protocol-version language only where it explains automatic
        negotiation or a real compatibility difference.
  - [x] Verify the quickstart against the current `MCPClient`, `MCPConnection`,
        `connect()`, and `close()` signatures.
- [x] [Environments](/v2/typescript/client/environments)
  - [x] Change the Node.js requirement from 20+ to `>=22.22.2`.
  - [x] Use the stable `@mcp-use/client` React installation example.
  - [x] Explain the root package's Node and browser conditional exports without
        presenting the package split as a migration.
  - [x] Distinguish `@mcp-use/client/react` connection-management APIs from
        `mcp-use/react` View APIs.
  - [x] Replace the stale widget-rendering sentence with current MCP Apps and
        Views terminology.
  - [x] Verify the Node, browser, and React capability table against package
        exports and runtime restrictions.
- [x] [Resources](/v2/typescript/client/resources)
  - [x] Fix the main example: `listResources()` returns an envelope containing
        `resources` and an optional `nextCursor`, not an iterable array.
  - [x] Show when to use `listAllResources()` instead of manually handling
        pagination.
  - [x] Document the `listResourceTemplates()` result envelope accurately.
  - [x] Replace the nonexistent `subscribeResource` name with
        `subscribeToResource`.
  - [x] Include `unsubscribeFromResource` where subscription lifecycle is
        described.
  - [x] Verify the React `readResource` example against the current
        `McpServer` return type.
  - [x] Type-check every example against `@mcp-use/client`.
- [x] [Prompts](/v2/typescript/client/prompts)
  - [x] Fix the main example: `listPrompts()` returns an envelope containing
        `prompts`, not an iterable array.
  - [x] Document the exact `getPrompt(name, args)` result shape.
  - [x] Verify the React example against the current `McpServer.getPrompt`
        signature.
  - [x] Add complete imports or surrounding setup where the examples otherwise
        require readers to guess.
  - [x] Type-check every example against `@mcp-use/client`.
- [x] [Sampling](/v2/typescript/client/sampling)
  - [x] Explain that sampling is retained for protocol compatibility and is
        deprecated by the current sessionless protocol.
  - [x] State precisely when `sampling/createMessage` can still be received,
        including the compatibility and input-required cases supported by the
        client.
  - [x] Do not present sampling as a primary capability of every current server
        connection.
  - [x] Keep the `OnSamplingCallback` example aligned with the current request
        and result types.
  - [x] Explain when the React provider queues `pendingSamplingRequests` and how
        `approveSampling` and `rejectSampling` resolve them.
  - [x] Verify the linked runnable example against the current package source.
- [x] [Notifications](/v2/typescript/client/notifications)
  - [x] Keep server-to-client notification handling separate from roots
        compatibility behavior.
  - [x] Mark `setRoots()` and `getRoots()` as compatibility APIs; roots are not
        part of the current sessionless protocol.
  - [x] Do not teach `setRoots()` as the primary example of sending a current
        client-to-server notification.
  - [x] Verify the documented list-change notification method names against the
        protocol package.
  - [x] Verify `notifications`, `unreadNotificationCount`, and
        `onNotificationReceived` against the current React types.
- [x] [Authentication](/v2/typescript/client/authentication)
  - [x] Fix the pre-registered `MCPClient` example to use
        `oauth.staticClientInfo.client_id`; `oauth.clientId` is the React config
        shape.
  - [x] Clearly separate `MCPClient` OAuth options from `useMcp` and
        `McpClientProvider` OAuth options.
  - [x] Verify automatic OAuth behavior separately for Node, the browser root
        entry, and React's explicit `pending_auth` flow.
  - [x] Verify `preventAutoAuth`, `useRedirectFlow`, `clientMetadataUrl`,
        `oauthProxyUrl`, and `proxyOAuthRequests` against their public types and
        defaults.
  - [x] Keep browser clients public and do not show `client_secret` in browser
        configuration.
  - [x] Add complete imports to the React and bearer-token examples.
  - [x] Type-check the Node and browser configuration examples.
- [x] [Client migration guide](/v2/typescript/client/migration)
  - [x] Keep version-comparison language confined to this migration guide.
  - [x] Change the Node.js requirement to `>=22.22.2`.
  - [x] Use stable `@mcp-use/client` and `@mcp-use/agent` install commands.
  - [x] Replace `versionNegotiation` with `protocolNegotiation`.
  - [x] Replace the nonexistent `mcp-use client connect --negotiate` example
        with `--protocol auto|legacy|modern`.
  - [x] Import native `MCPAgent` and `PROMPTS` from `@mcp-use/agent`; import
        `ServerManager` only from `@mcp-use/agent/langchain`.
  - [x] Separate the native agent API from the optional LangChain compatibility
        entry point.
  - [x] Remove the claim that server APIs, widgets, and the MCP Apps runtime did
        not break.
  - [x] Summarize the server API and widget-to-View changes accurately, then
        link to the dedicated Server and MCP Apps guidance.
  - [x] Revalidate removed subpaths, renamed fields, removed exports, OAuth
        behavior, Inspector callback paths, and the package split against current
        exports.
  - [x] Make the migration checklist executable without implying that migration
        terminology belongs on the other Client pages.
## Completion checks

- [x] Every unchecked page above is complete and reviewed against its stated
      page job.
- [x] All install commands use the beta channel while the packages remain in
      beta.
- [x] Non-migration pages describe the current product directly and avoid
      unnecessary "v1," "v2," "old," "new," and migration framing.
- [x] Deprecated widget terminology appears only where a compatibility note
      genuinely requires it.
- [x] All TypeScript and TSX examples type-check against the current workspace
      packages.
- [x] CLI examples match the current `--help` output.
- [x] `mint validate` passes.
- [x] `mint broken-links` passes.
- [x] `git diff --check` passes.
