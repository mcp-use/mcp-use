import chalk from "chalk";
import type { Plugin as EsbuildPlugin } from "esbuild";
import path from "node:path";

export const MCP_DIR_SERVER_OUTPUT = path.join("dist", "mcp", "index.mjs");

export const NEXT_SERVER_RUNTIME_MODULES = [
  "server-only",
  "client-only",
  "next/cache",
  "next/headers",
  "next/navigation",
  "next/server",
] as const;

type NextServerRuntimeShimWarning = {
  specifier: string;
  importer?: string;
};

type TsconfigShape = {
  compilerOptions?: {
    paths?: Record<string, string[]>;
  };
};

type TsconfigPathPattern = {
  prefix: string;
  suffix: string;
};

function getTsconfigPathPatterns(
  tsconfig: TsconfigShape
): TsconfigPathPattern[] {
  const paths = tsconfig.compilerOptions?.paths;
  if (!paths) return [];

  return Object.keys(paths).map((pattern) => {
    const starIndex = pattern.indexOf("*");
    if (starIndex === -1) return { prefix: pattern, suffix: "" };
    return {
      prefix: pattern.slice(0, starIndex),
      suffix: pattern.slice(starIndex + 1),
    };
  });
}

function matchesTsconfigPathPattern(
  specifier: string,
  pattern: TsconfigPathPattern
): boolean {
  if (!pattern.suffix && specifier === pattern.prefix) return true;
  return (
    specifier.startsWith(pattern.prefix) && specifier.endsWith(pattern.suffix)
  );
}

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("file:")
  );
}

function makeExternalizePackagesPlugin(
  tsconfigPathPatterns: TsconfigPathPattern[]
): EsbuildPlugin {
  return {
    name: "mcp-use-externalize-packages",
    setup(build) {
      build.onResolve({ filter: /^[^./]|^\.[^./]/ }, (args) => {
        if (!isBareSpecifier(args.path)) return null;
        if (args.path.startsWith("node:"))
          return { path: args.path, external: true };
        if (
          tsconfigPathPatterns.some((pattern) =>
            matchesTsconfigPathPattern(args.path, pattern)
          )
        ) {
          return null;
        }
        return { path: args.path, external: true };
      });
    },
  };
}

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
`;
    default:
      throw new Error(`No Next.js server-runtime shim for ${specifier}`);
  }
}

function makeNextServerRuntimeShimPlugin(
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

function printNextServerRuntimeShimWarnings(
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

export async function buildMcpDirServer(
  projectPath: string,
  sourceServerFile: string
): Promise<string> {
  const esbuild = await import("esbuild");
  const { promises: fs } = await import("node:fs");

  const tsconfigPath = path.join(projectPath, "tsconfig.json");
  let tsconfig: TsconfigShape = {};
  let esbuildTsconfig: string | undefined;
  try {
    const raw = await fs.readFile(tsconfigPath, "utf-8");
    tsconfig = JSON.parse(raw) as TsconfigShape;
    esbuildTsconfig = tsconfigPath;
  } catch {
    // No tsconfig: esbuild can still compile the entry, just without paths.
  }

  const warnings: NextServerRuntimeShimWarning[] = [];
  const outputFile = path.join(projectPath, MCP_DIR_SERVER_OUTPUT);

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(projectPath, sourceServerFile)],
    outfile: outputFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    tsconfig: esbuildTsconfig,
    sourcemap: false,
    logLevel: "warning",
    plugins: [
      makeNextServerRuntimeShimPlugin(projectPath, warnings),
      makeExternalizePackagesPlugin(getTsconfigPathPatterns(tsconfig)),
    ],
  });

  printNextServerRuntimeShimWarnings(warnings);
  return MCP_DIR_SERVER_OUTPUT;
}
