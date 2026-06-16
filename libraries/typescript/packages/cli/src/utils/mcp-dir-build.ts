import type { Plugin as EsbuildPlugin } from "esbuild";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import path from "node:path";
import {
  type NextServerRuntimeShimWarning,
  makeNextServerRuntimeShimPlugin,
  printNextServerRuntimeShimWarnings,
} from "./next-server-runtime-shims.js";

const MCP_DIR_SERVER_DIR = "dist/mcp";

// Possible built server artifacts. The extension depends on the host package's
// module system (see resolveServerOutput); listed CommonJS-first since most
// consumers (Next.js apps) are CommonJS-default. Used by `mcp-use start` as a
// fallback when the build manifest's entryPoint isn't available.
export const MCP_DIR_SERVER_OUTPUTS = [
  `${MCP_DIR_SERVER_DIR}/index.cjs`,
  `${MCP_DIR_SERVER_DIR}/index.mjs`,
];

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
    !specifier.startsWith("file:") &&
    !path.isAbsolute(specifier) &&
    !/^[A-Za-z]:[\\/]/.test(specifier)
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

// Decide the artifact's module system from the host package.json "type".
//
// This must match how Node will actually load the built file at runtime, which
// Node governs via package.json "type" (+ file extension) — NOT tsconfig
// "module". tsconfig "module" describes the TypeScript compiler's emit, and
// Next.js apps set "module":"esnext" with "moduleResolution":"bundler" while
// staying CommonJS at the package level (no "type" field). Keying off "type"
// keeps the output consistent with how the host resolves its dependencies'
// export conditions (require vs import). Default to CommonJS (Node's own
// default when "type" is absent).
async function resolveServerOutput(
  projectPath: string,
  fs: typeof import("node:fs").promises
): Promise<{ format: "cjs" | "esm"; relativePath: string }> {
  let packageType: string | undefined;
  try {
    const raw = await fs.readFile(
      path.join(projectPath, "package.json"),
      "utf-8"
    );
    packageType = (JSON.parse(raw) as { type?: string }).type;
  } catch {
    // No package.json — treat as CommonJS (Node's default).
  }

  const isEsm = packageType === "module";
  return {
    format: isEsm ? "esm" : "cjs",
    relativePath: `${MCP_DIR_SERVER_DIR}/index.${isEsm ? "mjs" : "cjs"}`,
  };
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
    const parseErrors: ParseError[] = [];
    tsconfig = parseJsonc(raw, parseErrors, {
      allowTrailingComma: true,
      disallowComments: false,
    }) as TsconfigShape;
    if (parseErrors.length > 0) {
      console.warn(
        `⚠ Could not parse ${path.relative(projectPath, tsconfigPath)} for path aliases; continuing without tsconfig path externalization.`
      );
      tsconfig = {};
    }
    esbuildTsconfig = tsconfigPath;
  } catch {
    // No tsconfig: esbuild can still compile the entry, just without paths.
  }

  const warnings: NextServerRuntimeShimWarning[] = [];
  const { format, relativePath } = await resolveServerOutput(projectPath, fs);
  const outputFile = path.join(projectPath, relativePath);

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(projectPath, sourceServerFile)],
    outfile: outputFile,
    bundle: true,
    format,
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
  return relativePath;
}
