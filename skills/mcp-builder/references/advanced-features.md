# Advanced features

Use these features only when the task requires them. Confirm exact options and current limitations against the installed package.

## OpenAPI-generated tools

Use `MCPServer.fromOpenAPI()` with a parsed, bundled OpenAPI 3.x document. Supply `baseUrl` when the document has no usable server URL. Use `tags` and `exclude` to limit exposed operations.

Bundle external `$ref` targets before creating the server. Generated inputs cover path, query, header, and JSON-compatible request bodies; cookie parameters and non-JSON bodies are not exposed. Generated tools do not derive `outputSchema` from response definitions.

## Proxy MCP servers

`server.proxy()` requires the optional `@mcp-use/client` package. Call it before `listen()` or the first `server.fetch` request. Config-map keys namespace upstream tools, static resources, and prompts.

Provide bearer tokens or headers explicitly; proxy startup does not run interactive OAuth. A config-created connection is owned by the server, while the application must close an explicitly supplied `MCPConnection`.

Do not assume every capability is forwarded. Confirm current support for resource templates, completions, subscriptions, and upstream list resynchronization before designing around them.

## Request-scoped notifications

Send status only while the originating callback is active:

```ts
await ctx.sendNotification("com.example/import-status", { status: "started" });
await ctx.reportProgress(50, 100, "Halfway");
await ctx.sendLog("info", { imported: 42 }, "import-worker");
```

Await notifications before returning. They are not a post-response broadcast channel. `reportProgress()` returns `false` when the caller supplied no progress token.

## List and resource invalidations

Publish cross-request invalidations only to clients with an active subscription listener:

```ts
await server.notifyToolsChanged();
await server.notifyPromptsChanged();
await server.notifyResourcesChanged();
await server.notifyResourceUpdated("config://settings");
```

Treat these as non-durable cache invalidations. Keep the resource or registry authoritative, make reads repeatable, and never depend on delivery of every event.

## Elicitation

Use `ctx.elicit(key, message, schemaOrUrl)` when a capable client must collect structured input or complete an external flow. Return `required.result` directly, then handle `accept`, `decline`, and `cancel` when the callback reruns.

```ts
const approval = await ctx.elicit("publish-approval", "Publish now?", schema);
if (approval.status === "required") return approval.result;
if (approval.status !== "accept" || !approval.data.approve) {
  return { isError: true, content: [{ type: "text", text: "Not approved" }] };
}
```

Callbacks rerun for input-required rounds. Perform irreversible side effects only after accepted input, use a distinct stable key for each question, validate any bare input responses, and use verified request state when continuity affects authorization or business logic. Never collect passwords, API keys, payment details, or OAuth secrets in a form elicitation.
