import type { Plugin as EsbuildPlugin } from "esbuild";
import path from "node:path";
import {
  type NextServerRuntimeShimWarning,
  makeNextServerRuntimeShimPlugin,
  printNextServerRuntimeShimWarnings,
} from "./next-server-runtime-shims.js";

export const MCP_DIR_SERVER_OUTPUT = path.join("dist", "mcp", "index.mjs");

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
