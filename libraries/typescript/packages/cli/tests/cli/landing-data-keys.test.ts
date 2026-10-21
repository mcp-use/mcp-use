/** Import-based detection of the landing data lists a page needs. */
import { describe, expect, it } from "vitest";
import { parseAst, transformWithOxc } from "vite";

import {
  createLandingDataKeysCollector,
  type GraphNode,
} from "../../src/cli/landing-data-keys.js";

type Collector = ReturnType<typeof createLandingDataKeysCollector>;

/**
 * Feed `source` through the plugin the way Vite does with `enforce: "post"`:
 * after the TypeScript/JSX transform, with the plugin context's parser.
 */
async function transform(
  collector: Collector,
  id: string,
  source: string
): Promise<void> {
  const { code } = await transformWithOxc(source, id, {
    jsx: { runtime: "automatic" },
  });
  const hook = collector.plugin.transform as (
    this: { parse: typeof parseAst },
    code: string,
    id: string
  ) => unknown;
  await hook.call({ parse: parseAst }, code, id);
}

async function keysOf(source: string, id = "/app/landing.tsx") {
  const collector = createLandingDataKeysCollector({ environment: "client" });
  await transform(collector, id, source);
  return collector.all();
}

describe("landing data keys plugin", () => {
  it("runs after other transforms in the named environment only", () => {
    const { plugin } = createLandingDataKeysCollector({ environment: "ssr" });
    expect(plugin.enforce).toBe("post");
    const applies = plugin.applyToEnvironment as (environment: {
      name: string;
    }) => boolean;
    expect(applies({ name: "ssr" })).toBe(true);
    expect(applies({ name: "client" })).toBe(false);
  });

  it("maps named hook imports to their keys", async () => {
    expect(
      await keysOf(`import { useServerInfo, useToolList, usePromptList } from "mcp-use/landing";
export default () => <p>{useServerInfo().name}{useToolList().length}{usePromptList().length}</p>;
`)
    ).toEqual(["prompts", "tools"]);
  });

  it("maps aliased imports by the imported name", async () => {
    expect(
      await keysOf(`import { useResourceList as resources, useServerInfo as useToolList } from "mcp-use/landing";
export default () => <p>{resources().length}{useToolList().name}</p>;
`)
    ).toEqual(["resources"]);
  });

  it("counts re-exports of the hooks", async () => {
    expect(
      await keysOf(
        `export { useToolList, usePromptList as prompts } from "mcp-use/landing";\n`,
        "/app/hooks.ts"
      )
    ).toEqual(["prompts", "tools"]);
  });

  it("treats namespace imports and export-all as every list", async () => {
    const all = ["prompts", "resources", "tools"];
    expect(
      await keysOf(`import * as landing from "mcp-use/landing";
export default () => <p>{landing.useServerInfo().name}</p>;
`)
    ).toEqual(all);
    expect(
      await keysOf(`export * from "mcp-use/landing";\n`, "/app/hooks.ts")
    ).toEqual(all);
    expect(
      await keysOf(
        `export * as landing from "mcp-use/landing";\n`,
        "/app/hooks.ts"
      )
    ).toEqual(all);
  });

  it("ignores type-only imports", async () => {
    expect(
      await keysOf(`import type { useToolList } from "mcp-use/landing";
import { type usePromptList, useServerInfo } from "mcp-use/landing";
type Tools = ReturnType<typeof useToolList>;
type Prompts = ReturnType<typeof usePromptList>;
export const empty: Tools & Prompts = [] as never;
export default () => <p>{useServerInfo().name}</p>;
`)
    ).toEqual([]);
  });

  it("ignores other module sources and node_modules", async () => {
    expect(
      await keysOf(`import { useToolList } from "./mcp-use/landing";
import { usePromptList } from "mcp-use/landing-extra";
export default () => <p>{useToolList().length}{usePromptList().length}</p>;
`)
    ).toEqual([]);
    expect(
      await keysOf(
        `import { useToolList } from "mcp-use/landing";\nexport const tools = useToolList;\n`,
        "/app/node_modules/ui-kit/index.js"
      )
    ).toEqual([]);
  });

  it("replaces a module's record when it is transformed again", async () => {
    const collector = createLandingDataKeysCollector({ environment: "ssr" });
    await transform(
      collector,
      "/app/landing.tsx",
      `import { useToolList } from "mcp-use/landing";\nexport default () => <p>{useToolList().length}</p>;\n`
    );
    expect(collector.all()).toEqual(["tools"]);
    await transform(
      collector,
      "/app/landing.tsx",
      `export default () => <p>static</p>;\n`
    );
    expect(collector.all()).toEqual([]);
  });

  it("resolves keys from the modules reachable in the import graph", async () => {
    const collector = createLandingDataKeysCollector({ environment: "ssr" });
    await transform(
      collector,
      "/app/tools.tsx",
      `import { useToolList } from "mcp-use/landing";\nexport const Tools = () => <p>{useToolList().length}</p>;\n`
    );
    await transform(
      collector,
      "/app/prompts.tsx",
      `import { usePromptList } from "mcp-use/landing";\nexport const Prompts = () => <p>{usePromptList().length}</p>;\n`
    );
    const tools = node("/app/tools.tsx");
    const prompts = node("/app/prompts.tsx");
    const landing = node("/app/landing.tsx", [tools]);
    const root = node("\0virtual:root", [landing, landing]);
    const unexpected = async (): Promise<never> => {
      throw new Error("every module is already transformed");
    };
    expect(await collector.reachableFrom(root, unexpected)).toEqual(["tools"]);
    expect(await collector.reachableFrom(undefined, unexpected)).toEqual([]);
    landing.importedModules = [tools, prompts];
    expect(await collector.reachableFrom(root, unexpected)).toEqual([
      "prompts",
      "tools",
    ]);
  });

  it("transforms reachable modules the server render never loaded", async () => {
    const collector = createLandingDataKeysCollector({ environment: "ssr" });
    // A lazily imported child: in the graph, but never transformed.
    const lazyChild = node("/app/tools.tsx", [], null);
    const failing = node("/app/broken.tsx", [], null);
    const dependency = node("/app/node_modules/ui-kit/index.js", [], null);
    const root = node("\0virtual:root", [lazyChild, failing, dependency]);
    const transformed: string[] = [];
    const keys = await collector.reachableFrom(root, async (target) => {
      transformed.push(target.url);
      if (target === failing) throw new Error("syntax error");
      await transform(
        collector,
        "/app/tools.tsx",
        `import { useToolList } from "mcp-use/landing";\nexport default () => <p>{useToolList().length}</p>;\n`
      );
      lazyChild.transformResult = {};
    });
    expect(keys).toEqual(["tools"]);
    expect(transformed.sort()).toEqual(["/app/broken.tsx", "/app/tools.tsx"]);
  });
});

interface TestNode extends GraphNode {
  transformResult: unknown;
  importedModules: TestNode[];
}

/** A module graph node; `transformResult: null` marks an untransformed one. */
function node(
  id: string,
  importedModules: TestNode[] = [],
  transformResult: unknown = {}
): TestNode {
  return { id, url: id, transformResult, importedModules };
}
