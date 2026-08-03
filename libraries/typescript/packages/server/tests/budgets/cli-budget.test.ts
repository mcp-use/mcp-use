import { isBuiltin } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import { init, parse } from "es-module-lexer";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const DIST = new URL("../../dist/", import.meta.url);
const CLI_DIST = new URL("../../../cli/dist/", import.meta.url);

await init;

interface ModuleGraph {
  files: Map<string, string>;
  staticPackages: Set<string>;
  dynamicSpecifiers: Set<string>;
}

describe("published CLI boundaries", () => {
  it("does not publish the removed v1 compatibility surface", async () => {
    expect(packageJson.exports).not.toHaveProperty("./server");
    expect(
      (await readdir(DIST, { recursive: true })).filter((file) =>
        file.includes("compat-v1")
      )
    ).toEqual([]);
  });

  it("keeps the complete edge graph free of static node and toolchain leaks", async () => {
    const graph = await buildStaticGraph(new URL("index.js", DIST));
    const proxyTypes = await readFile(new URL("mcp-proxy.d.ts", DIST), "utf8");

    expectForbiddenPackages(graph, "edge", true);
    expect(
      [...graph.files.keys()].filter((file) => file.includes("/commands/")),
      "the edge graph must not reach command chunks"
    ).toEqual([]);
    expect(
      [...graph.files.values()].join("\n"),
      "the edge graph must include the edge-safe Node response bridge"
    ).toContain("toNodeHandler");
    expect(
      graph.staticPackages,
      "listen() must resolve Node HTTP through the package condition map"
    ).toContain("#mcp-use-node-http");
    expect(
      [...graph.dynamicSpecifiers].some((specifier) =>
        specifier.includes("public-route")
      ),
      "public assets must lazy-load filesystem helpers"
    ).toBe(true);
    expect(
      [...graph.dynamicSpecifiers].some((specifier) =>
        specifier.includes("mcp-proxy")
      ),
      "proxying must stay behind its own lazy chunk"
    ).toBe(true);
    expect(
      [...graph.files.values()].join("\n"),
      "the library entry must not resolve the optional client peer"
    ).not.toContain("@mcp-use/client");
    expect(
      proxyTypes,
      "public declarations must not require the optional client peer"
    ).not.toMatch(/\bfrom\s+["']@mcp-use\/client["']/);
  });

  it("keeps the static start graph free of node, toolchain, and cross-command imports", async () => {
    const graph = await buildStaticGraph(
      new URL("commands/start.js", CLI_DIST)
    );

    expectForbiddenPackages(graph, "start", true);
    expect(
      [...graph.files.keys()].filter((file) =>
        /\/commands\/(?!start\.js$)[^/]+\.js$/.test(file)
      ),
      "start must not reach another command entry"
    ).toEqual([]);
    expect(
      [...graph.dynamicSpecifiers].some((specifier) =>
        /(?:^|\/)start-[A-Z0-9]+\.js$/.test(specifier)
      ),
      "start must lazy-load its Node-only implementation"
    ).toBe(true);
  });

  it("dispatches every substantial command through a dynamic chunk", async () => {
    const frameworkBin = await buildStaticGraph(new URL("bin.js", DIST));
    expect(frameworkBin.dynamicSpecifiers).toContain("@mcp-use/cli");

    const cliBin = await buildStaticGraph(new URL("bin.js", CLI_DIST));
    for (const command of [
      "start",
      "dev",
      "build",
      "typecheck",
      "identity",
      "organizations",
      "servers",
      "deployments",
      "deploy",
      "client",
      "screenshot",
    ]) {
      expect(cliBin.dynamicSpecifiers).toContain(`./commands/${command}.js`);
    }
  });

  it("keeps the edge entry under eighty KiB and its static graph under one hundred twenty KiB", async () => {
    const entry = new URL("index.js", DIST);
    const graph = await buildStaticGraph(entry);
    const graphBytes = await sumFileBytes(graph.files.keys());

    expect((await stat(entry)).size).toBeLessThanOrEqual(80 * 1024);
    expect(graphBytes).toBeLessThanOrEqual(120 * 1024);
  });

  it("keeps the unpacked framework artifact below five MiB", async () => {
    expect(await directoryBytes(DIST)).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("keeps skill discovery self-contained without a runtime dependency", async () => {
    expect(packageJson.dependencies).not.toHaveProperty("yaml");

    const graph = await buildStaticGraph(
      new URL("internal/skills-loader.js", DIST)
    );
    expect(
      [...graph.staticPackages].filter((specifier) => !isBuiltin(specifier))
    ).toEqual([]);
    const source = [...graph.files.values()].join("\n");
    expect(source).not.toContain('from"yaml"');
    expect(source).not.toContain("Dynamic require");
  });

  it("declares every external package used by the Node bundle", async () => {
    const graph = await buildStaticGraph(new URL("index-node.js", DIST));
    const declaredRuntimePackages = new Set([
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.peerDependencies),
    ]);
    const undeclared = [...graph.staticPackages].filter(
      (specifier) =>
        !isBuiltin(specifier) &&
        !declaredRuntimePackages.has(packageName(specifier))
    );

    expect(undeclared).toEqual([]);
    expect(graph.staticPackages).not.toContain("zod");
    expect(graph.staticPackages).not.toContain("zod/v4");
  });
});

function packageName(specifier: string): string {
  if (!specifier.startsWith("@")) {
    const separator = specifier.indexOf("/");
    return separator === -1 ? specifier : specifier.slice(0, separator);
  }
  const separator = specifier.indexOf("/", specifier.indexOf("/") + 1);
  return separator === -1 ? specifier : specifier.slice(0, separator);
}

function expectForbiddenPackages(
  graph: ModuleGraph,
  label: string,
  forbidNodeBuiltins: boolean
): void {
  const forbidden = [...graph.staticPackages].filter(
    (specifier) =>
      specifier === "vite" ||
      specifier.startsWith("@vitejs/") ||
      specifier === "@mcp-use/client" ||
      specifier.startsWith("@modelcontextprotocol/sdk") ||
      specifier === "express" ||
      (forbidNodeBuiltins && isBuiltin(specifier))
  );
  expect(forbidden, `${label} reached forbidden static packages`).toEqual([]);
}

async function buildStaticGraph(entry: URL): Promise<ModuleGraph> {
  const graph: ModuleGraph = {
    files: new Map(),
    staticPackages: new Set(),
    dynamicSpecifiers: new Set(),
  };

  async function visit(file: URL): Promise<void> {
    if (graph.files.has(file.href)) return;
    const source = await readFile(file, "utf8");
    graph.files.set(file.href, source);
    const specifiers = parseModuleSpecifiers(source, file.pathname);
    for (const specifier of specifiers.dynamic) {
      graph.dynamicSpecifiers.add(specifier);
    }
    for (const specifier of specifiers.static) {
      if (specifier.startsWith(".")) {
        await visit(new URL(specifier, file));
      } else {
        graph.staticPackages.add(specifier);
      }
    }
  }

  await visit(entry);
  return graph;
}

function parseModuleSpecifiers(
  source: string,
  _fileName: string
): { static: string[]; dynamic: string[] } {
  const staticSpecifiers: string[] = [];
  const dynamicSpecifiers: string[] = [];
  const [imports] = parse(source);
  for (const imported of imports) {
    if (imported.n === undefined) continue;
    if (imported.d === -1) staticSpecifiers.push(imported.n);
    else dynamicSpecifiers.push(imported.n);
  }
  return { static: staticSpecifiers, dynamic: dynamicSpecifiers };
}

async function sumFileBytes(files: Iterable<string>): Promise<number> {
  let bytes = 0;
  for (const file of files) bytes += (await stat(new URL(file))).size;
  return bytes;
}

async function directoryBytes(directory: URL): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      bytes += await directoryBytes(new URL(`${entry.name}/`, directory));
    } else {
      bytes += (await stat(path)).size;
    }
  }
  return bytes;
}
