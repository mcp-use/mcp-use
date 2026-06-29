import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ponytail: __filename in CJS bundle, import.meta.url in ESM
const moduleDir =
  typeof __filename !== "undefined"
    ? dirname(__filename)
    : dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  typeof __filename !== "undefined"
    ? __filename
    : fileURLToPath(import.meta.url)
);
const warned = new Set<string>();

function deprecateRootExport(exportName: string, target: string): void {
  const key = `${exportName}→${target}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[mcp-use] Importing "${exportName}" from "mcp-use" is deprecated. Use "${target}" instead.`
  );
}

export function lazyClass<T extends abstract new (...args: never[]) => unknown>(
  exportName: string,
  target: string,
  load: () => T
): T {
  let cached: T | undefined;
  const getClass = () => {
    if (!cached) {
      deprecateRootExport(exportName, target);
      cached = load();
    }
    return cached;
  };
  return new Proxy(function () {} as unknown as T, {
    construct(_target, args, newTarget) {
      return Reflect.construct(getClass(), args, newTarget);
    },
    get(_target, prop) {
      const record = getClass() as Record<string | symbol, unknown>;
      const value = record[prop];
      return typeof value === "function" ? value.bind(getClass()) : value;
    },
  });
}

export function lazyBinding<T>(
  exportName: string,
  target: string,
  load: () => T
): T {
  let cached: T | undefined;
  const getValue = () => {
    if (cached === undefined) {
      deprecateRootExport(exportName, target);
      cached = load();
    }
    return cached;
  };

  return new Proxy({} as object, {
    apply(_target, thisArg, args) {
      const value = getValue();
      if (typeof value !== "function") {
        throw new TypeError(`${exportName} is not callable`);
      }
      return Reflect.apply(
        value as (...a: unknown[]) => unknown,
        thisArg,
        args
      );
    },
    get(_target, prop) {
      const record = getValue() as Record<string | symbol, unknown>;
      const value = record[prop];
      return typeof value === "function" ? value.bind(getValue()) : value;
    },
  }) as T;
}

function findDistDir(): string {
  const normalized = moduleDir.replace(/\\/g, "/");
  if (normalized.endsWith("/dist")) {
    return moduleDir;
  }
  if (normalized.endsWith("/dist/src/root")) {
    return join(moduleDir, "..", "..");
  }
  if (normalized.endsWith("/src/root")) {
    return join(moduleDir, "..", "..", "dist");
  }
  return join(moduleDir, "dist");
}

/** Sync require helper — paths are under `dist/src/` (e.g. `client.js`). */
export function rootRequire<T>(relativeFromDistSrc: string): T {
  const target = join(
    findDistDir(),
    "src",
    `${relativeFromDistSrc.replace(/\.js$/, "")}.js`
  );
  return require(target) as T;
}
