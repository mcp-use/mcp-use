import chalk from "chalk";
import type { Plugin as EsbuildPlugin } from "esbuild";
import path from "node:path";

export const NEXT_SERVER_RUNTIME_MODULES = [
  "server-only",
  "client-only",
  "next/cache",
  "next/headers",
  "next/navigation",
  "next/server",
] as const;

export type NextServerRuntimeShimWarning = {
  specifier: string;
  importer?: string;
};

function getNextServerRuntimeShimModule(specifier: string): string {
  switch (specifier) {
    case "server-only":
    case "client-only":
      return "export {};";
    case "next/cache":
      return `
export function revalidatePath() {}
export function revalidateTag() {}
export function unstable_cache(fn) { return fn; }
export function unstable_noStore() {}
export const unstable_cacheLife = () => {};
export const unstable_cacheTag = () => {};
`;
    case "next/headers":
      return `
export function headers() { return new Headers(); }
export function cookies() {
  return {
    get() { return undefined; },
    getAll() { return []; },
    has() { return false; },
    set() {},
    delete() {},
  };
}
export function draftMode() {
  return {
    isEnabled: false,
    enable() {},
    disable() {},
  };
}
`;
    case "next/navigation":
      return `
export function redirect(url) {
  const err = new Error(\`redirect(\${url}) called outside Next.js\`);
  err.digest = "NEXT_REDIRECT;" + url;
  throw err;
}
export function permanentRedirect(url) { return redirect(url); }
export function notFound() {
  const err = new Error("notFound() called outside Next.js");
  err.digest = "NEXT_NOT_FOUND";
  throw err;
}
export const RedirectType = { push: "push", replace: "replace" };
`;
    case "next/server":
      return `
export class NextResponse extends Response {
  static json(data, init) {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: { ...((init && init.headers) || {}), "content-type": "application/json" },
    });
  }
  static redirect(url, status) {
    return new Response(null, { status: status || 302, headers: { location: String(url) } });
  }
  static next() { return new Response(null); }
  static rewrite() { return new Response(null); }
}
export class NextRequest extends Request {
  constructor(input, init) {
    super(input, init);
    this.nextUrl = new URL(typeof input === "string" ? input : input.url);
    this.cookies = {
      get() { return undefined; },
      getAll() { return []; },
      has() { return false; },
      set() {},
      delete() {},
    };
  }
}
export const userAgent = () => ({
  ua: "",
  browser: {},
  device: {},
  engine: {},
  os: {},
  cpu: {},
  isBot: false,
});
export function after(callback) {
  if (typeof callback === "function") {
    Promise.resolve().then(callback).catch(() => {});
  }
}
`;
    default:
      throw new Error(`No Next.js server-runtime shim for ${specifier}`);
  }
}

export function makeNextServerRuntimeShimPlugin(
  projectPath: string,
  warnings: NextServerRuntimeShimWarning[]
): EsbuildPlugin {
  const namespace = "mcp-use-next-server-runtime-shim";
  const shimmed = new Set<string>(NEXT_SERVER_RUNTIME_MODULES);
  const filter =
    /^(server-only|client-only|next\/cache|next\/headers|next\/navigation|next\/server)$/;

  return {
    name: "mcp-use-next-server-runtime-shims",
    setup(build) {
      build.onResolve({ filter }, (args) => {
        if (!shimmed.has(args.path)) return null;
        warnings.push({
          specifier: args.path,
          importer: args.importer
            ? path.relative(projectPath, args.importer)
            : undefined,
        });
        return {
          path: args.path,
          namespace,
        };
      });

      build.onLoad({ filter: /.*/, namespace }, (args) => ({
        contents: getNextServerRuntimeShimModule(args.path),
        loader: "js",
      }));
    },
  };
}

export function printNextServerRuntimeShimWarnings(
  warnings: NextServerRuntimeShimWarning[]
): void {
  if (warnings.length === 0) return;

  const grouped = new Map<string, Set<string>>();
  for (const warning of warnings) {
    const importers = grouped.get(warning.specifier) ?? new Set<string>();
    importers.add(warning.importer || "<entry>");
    grouped.set(warning.specifier, importers);
  }

  console.log(
    chalk.yellow(
      `⚠ Replaced ${warnings.length} Next.js server-runtime import${warnings.length === 1 ? "" : "s"} with MCP shims:`
    )
  );
  for (const [specifier, importers] of grouped) {
    console.log(chalk.yellow(`  ${specifier}`));
    for (const importer of importers) {
      console.log(chalk.gray(`    - ${importer}`));
    }
  }
  console.log(
    chalk.gray(
      "  These shims run outside the Next.js request runtime. headers()/cookies() return empty stand-ins, cache revalidation is a no-op, and redirect()/notFound() still throw."
    )
  );
}
