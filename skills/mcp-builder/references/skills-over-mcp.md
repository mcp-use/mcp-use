# Skills over MCP

Skills let a server ship reusable operating instructions alongside its tools. Prefer a Skill when a task requires a repeatable multi-step workflow, policies, reference material, templates, or scripts that would otherwise bloat tool descriptions.

Do not replace an executable capability with prose: tools perform actions, resources expose content, prompts return model-ready messages, and Skills teach an agent how to combine them safely.

## Add a Skill

Create a conventional `skills/` directory beside the server entry. Its presence enables discovery automatically.

```text
skills/
  process-refund/
    SKILL.md
    references/
      policy.md
    templates/
      confirmation.md
```

Every skill needs a directory-matching `SKILL.md` with concise trigger metadata and task instructions:

```md
---
name: process-refund
description: Check refund eligibility and process approved customer refunds
---

# Process refunds

Read `references/policy.md` before deciding eligibility.
Use `templates/confirmation.md` after a successful refund.
```

Keep `SKILL.md` procedural and small. Put detailed policies and domain knowledge in references, deterministic operations in scripts, and output templates or binary material in supporting files. Link every supporting file directly from `SKILL.md` and state when to read or use it.

## Configure discovery

Normally omit `skills` from `MCPServer` configuration. Use an explicit option only when behavior must differ:

```ts
new MCPServer({ name: "shop", version: "1.0.0", skills: true });
new MCPServer({ name: "shop", version: "1.0.0", skills: false });
new MCPServer({
  name: "shop",
  version: "1.0.0",
  skills: { directory: "server-skills" },
});
```

- `true` requires the conventional directory.
- `false` ignores a conventional directory.
- A custom directory is project-relative.
- With `--mcp-dir`, automatic discovery follows the MCP source directory; an explicit custom directory remains project-relative.

## Understand discovery and validation

The server advertises the draft Skills over MCP extension. Hosts inspect the catalog with `skills/list`, retrieve a Skill with `skills/get`, and read supporting content through resource directory and file reads. The SDK does not inject Skill text into server instructions or tool descriptions; activation remains a host decision.

Serve only trusted Skills. A host should require appropriate user approval before activating a Skill or its allowed tools.

During `mcp-use dev`, invalid Skills are logged and omitted until fixed. `mcp-use build` is strict and fails for an invalid catalog, then embeds the validated snapshot into the production build.
