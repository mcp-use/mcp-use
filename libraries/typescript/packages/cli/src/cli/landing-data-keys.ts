/**
 * Which optional lists a `landing.tsx` page reads, found from its imports.
 *
 * The rendered page ships `server` info always, and each of `tools`,
 * `prompts` and `resources` only when some module under `landing.tsx` imports
 * the matching hook from `mcp-use/landing`. The plugin runs after the
 * TypeScript transform, so `import type` and unused imports are already gone.
 */

import type { Plugin } from "vite";

/** Optional landing data lists, mirroring `LandingDataKey` in `mcp-use`. */
export type LandingDataKey = "tools" | "prompts" | "resources";

const LANDING_MODULE = "mcp-use/landing";

const HOOK_KEYS: Readonly<Record<string, LandingDataKey>> = {
  useToolList: "tools",
  usePromptList: "prompts",
  useResourceList: "resources",
};

const ALL_KEYS: readonly LandingDataKey[] = ["prompts", "resources", "tools"];

/** The ESTree fields this plugin reads; other node fields are ignored. */
interface ModuleNode {
  type: string;
  source?: { value?: unknown } | null;
  importKind?: string;
  exportKind?: string;
  specifiers?: readonly {
    type: string;
    importKind?: string;
    exportKind?: string;
    imported?: { name?: string; value?: unknown };
    local?: { name?: string; value?: unknown };
  }[];
}

/** A module graph node, as Vite's `EnvironmentModuleNode` exposes it. */
export interface GraphNode {
  id: string | null;
  url: string;
  /** Cleared when the module is invalidated; unset until first transformed. */
  transformResult?: unknown;
  importedModules: Iterable<GraphNode>;
}

/** Records hook imports per module and resolves them to data keys. */
export interface LandingDataKeysCollector {
  /** Vite plugin that records each transformed module's hook imports. */
  plugin: Plugin;
  /** Sorted keys recorded across every transformed module. */
  all(): LandingDataKey[];
  /**
   * Sorted keys recorded by `root` and every module it imports, statically
   * or dynamically. A dev server reuses cached transforms across reloads, so
   * the graph, not the set of transforms seen, decides what is current.
   *
   * `transform` runs first for each reachable module with no current
   * transform: a dynamic import the server render never ran, or a file
   * edited since. Its record, and the imports it adds, then count too.
   */
  reachableFrom(
    root: GraphNode | undefined,
    transform: (node: GraphNode) => Promise<unknown>
  ): Promise<LandingDataKey[]>;
}

function exportedName(
  node: { name?: string; value?: unknown } | undefined
): string | undefined {
  if (node === undefined) return undefined;
  return typeof node.value === "string" ? node.value : node.name;
}

/** Keys a module's top-level imports and re-exports of the hooks require. */
function collectKeys(body: readonly ModuleNode[]): Set<LandingDataKey> {
  const keys = new Set<LandingDataKey>();
  const add = (name: string | undefined): void => {
    const key = name === undefined ? undefined : HOOK_KEYS[name];
    if (key !== undefined) keys.add(key);
  };
  for (const node of body) {
    if (node.source?.value !== LANDING_MODULE) continue;
    if (node.type === "ImportDeclaration") {
      if (node.importKind === "type") continue;
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          return new Set(ALL_KEYS);
        }
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.importKind !== "type"
        ) {
          add(exportedName(specifier.imported));
        }
      }
    } else if (node.type === "ExportAllDeclaration") {
      if (node.exportKind !== "type") return new Set(ALL_KEYS);
    } else if (node.type === "ExportNamedDeclaration") {
      if (node.exportKind === "type") continue;
      for (const specifier of node.specifiers ?? []) {
        // `local` names the binding in the source module, before any `as`.
        if (specifier.exportKind !== "type") {
          add(exportedName(specifier.local));
        }
      }
    }
  }
  return keys;
}

function sorted(keys: Iterable<LandingDataKey>): LandingDataKey[] {
  return [...new Set(keys)].sort();
}

/** Installed packages: their hook imports never count. */
function isDependency(id: string): boolean {
  return id.replaceAll("\\", "/").includes("/node_modules/");
}

/** `root` and every module it imports, statically or dynamically. */
function reachable(root: GraphNode | undefined): GraphNode[] {
  const seen = new Set<GraphNode>();
  const pending = root === undefined ? [] : [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (seen.has(node)) continue;
    seen.add(node);
    pending.push(...node.importedModules);
  }
  return [...seen];
}

/**
 * Create a collector whose plugin runs in the named Vite environment only:
 * `client` for the production landing build, `ssr` for the dev module runner
 * that renders the page before the browser has requested any module.
 */
export function createLandingDataKeysCollector(options: {
  environment: string;
}): LandingDataKeysCollector {
  const records = new Map<string, Set<LandingDataKey>>();
  const plugin: Plugin = {
    name: "mcp-use-landing-data-keys",
    enforce: "post",
    applyToEnvironment(environment) {
      return environment.name === options.environment;
    },
    transform(code, id) {
      // A re-transform replaces the module's previous record.
      records.delete(id);
      if (isDependency(id) || !code.includes(LANDING_MODULE)) {
        return undefined;
      }
      let body: readonly ModuleNode[];
      try {
        body = (this.parse(code) as unknown as { body: readonly ModuleNode[] })
          .body;
      } catch {
        // Not JavaScript (yet); the module's own pipeline reports real errors.
        return undefined;
      }
      const keys = collectKeys(body);
      if (keys.size > 0) records.set(id, keys);
      return undefined;
    },
  };
  return {
    plugin,
    all() {
      return sorted([...records.values()].flatMap((keys) => [...keys]));
    },
    async reachableFrom(root, transform) {
      const attempted = new Set<GraphNode>();
      for (;;) {
        const nodes = reachable(root);
        const stale = nodes.filter(
          (node) =>
            node.id !== null &&
            node.transformResult == null &&
            !isDependency(node.id) &&
            !attempted.has(node)
        );
        if (stale.length === 0) {
          return sorted(
            nodes.flatMap((node) =>
              node.id === null ? [] : [...(records.get(node.id) ?? [])]
            )
          );
        }
        // A transform can add imports to the graph, so walk again after it.
        // A failing one keeps its old record; loading the page reports it.
        for (const node of stale) attempted.add(node);
        await Promise.all(
          stale.map((node) => transform(node).catch(() => undefined))
        );
      }
    },
  };
}
