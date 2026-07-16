# Generated World example

A v2 `mcp-use` MCP App that lets the model author a complete small
Three.js environment as JavaScript, then gives the user a flying camera to tour
it. It uses code as a compact scene description and renders viable source
prefixes while the `render_world` arguments are still streaming.

## Architecture

1. The model calls `read_world_guide`, then writes the body of
   `async buildWorld({ THREE, scene, random, onFrame })` into `render_world`.
2. The MCP server enforces only the 180 KiB payload ceiling and returns the
   source as `structuredContent` without trying to predict whether it will run.
   `read_world_guide` still tells the model to avoid browser globals, network
   APIs, imports, timers, and custom render loops; those are prompt-level
   authoring constraints rather than keyword rejections.
3. The MCP App immediately creates a long-lived in-memory `blob:` document
   inside a nested `<iframe sandbox="allow-scripts">` and supplies only
   Three.js, a scene, seeded randomness, and a bounded animation hook.
4. As `useToolContext().toolInput.source` grows, the iframe dynamically imports
   each syntactically complete prefix as an in-memory module. It builds into a
   fresh scene and atomically swaps successful revisions, leaving the last good
   scene visible when the current prefix is incomplete.
5. The exact failure is also written into `ModelContext`, allowing compatible
   clients to give it back to the agent for the next revision.
6. A trusted runtime owns WebGL, resize behavior, scene-budget checks, and the
   flying camera. While source streams, the camera is locked in an elevated
   three-quarter view of the origin and the model is instructed to build
   roofless, open-top environments. The runtime removes scene fog so construction
   and exploration remain unobstructed. A runtime-owned sky and directional fill
   light guarantee baseline visibility without consuming the generated scene's
   budgets; model-authored lights remain additive. After the final result builds
   successfully, the camera moves to the authored spawn; WASD or arrows move,
   Q/E move vertically, dragging looks, and Shift boosts.

The progressive loader does not execute malformed JavaScript. A streamed prefix
only becomes visible when it forms a valid function body and constructs at
least one scene object. Temporary syntax and runtime failures are expected and
silent during generation; the final source still reports an exact error to the
view and model context.

## Data flow

There is no asset-upload or persistence endpoint. The source necessarily
travels through the MCP tool request to whichever server you configure, then
comes back in that call's result. The example keeps no database, object store,
checkpoint, or server-side generated file.

- With a local MCP server, the app adds no remote source transfer of its own.
- With a remote MCP server, the source is transmitted to that server but is not
  stored by this implementation.
- The browser downloads the pinned Three.js module from `https://esm.sh`; the
  generated iframe's CSP allows no other network destination.

The nested sandbox and CSP are intended for cooperative model-authored code,
not arbitrary hostile JavaScript. Generated code can use browser globals inside
the sandbox, although network destinations remain restricted. A synchronous
infinite loop can hang the iframe because JavaScript cannot interrupt it after
it starts. Production deployments should add isolation appropriate to their
threat model.

## Runtime limits

- 180 KiB source
- 1,500 scene objects and 2,400 object additions
- 1,000,000 triangles and 3,000,000 vertices
- 32 lights and 64 `onFrame` callbacks
- 8-second asynchronous construction deadline

Prefer `InstancedMesh` for repeated geometry. Avoid long synchronous loops;
JavaScript cannot interrupt one after it begins.

## Run locally

From this directory, after installing workspace dependencies from the
TypeScript monorepo root:

```sh
pnpm install
pnpm dev
```

The MCP endpoint is `http://localhost:3000/mcp`. Open
`http://localhost:3000/mcp/inspector`, call `read_world_guide`, then call
`render_world` and inspect the MCP Apps component response.

```sh
pnpm typecheck
pnpm build && pnpm start
```
