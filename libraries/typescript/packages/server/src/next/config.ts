const DEFAULT_BASE_PATH = "/api/mcp";
const BUILD_TRACE_GLOB = "./.mcp-use/build/**/*";

interface NextHeader {
  key: string;
  value: string;
}

interface NextHeaderRule {
  source: string;
  headers: NextHeader[];
}

/** Minimal structural Next.js config type, avoiding a runtime Next dependency. */
export interface NextConfigLike {
  /** Preserve arbitrary Next.js settings while augmenting the fields we use. */
  [key: string]: unknown;
  headers?: () => NextHeaderRule[] | Promise<NextHeaderRule[]>;
  outputFileTracingIncludes?: Record<string, string[]>;
}

/** Options for {@link withMcpUse}. */
export interface WithMcpUseOptions {
  /** Authored MCP server entry, relative to `projectRoot`. */
  entry?: string;
  /** Conventional MCP source directory containing the entry and `views/`. */
  mcpDir?: string;
  /** Explicit views directory, relative to `projectRoot`. */
  viewsDir?: string;
  /** MCP route mounted by the application. Defaults to `/api/mcp`. */
  basePath?: string;
  /** Next.js project root. Defaults to `process.cwd()`. */
  projectRoot?: string;
}

const MCP_CORS_HEADERS: NextHeader[] = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  {
    key: "Access-Control-Allow-Methods",
    value: "GET, POST, DELETE, OPTIONS",
  },
  {
    key: "Access-Control-Allow-Headers",
    value:
      "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
  },
  { key: "Access-Control-Expose-Headers", value: "Mcp-Session-Id" },
];

function normalizeBasePath(value: string | undefined): string {
  const raw = value ?? DEFAULT_BASE_PATH;
  if (!raw.startsWith("/") || raw === "/" || raw.includes(":")) {
    throw new Error(
      `withMcpUse basePath must be a concrete absolute path; received ${JSON.stringify(raw)}.`
    );
  }
  return raw.replace(/\/+$/, "");
}

function mergeHeaders(
  existing: NextHeader[],
  additions: NextHeader[]
): NextHeader[] {
  const next = [...existing];
  for (const header of additions) {
    const index = next.findIndex(
      (candidate) => candidate.key.toLowerCase() === header.key.toLowerCase()
    );
    if (index === -1) next.push(header);
    else next[index] = header;
  }
  return next;
}

async function buildMcpProject(
  projectRoot: string,
  options: WithMcpUseOptions
): Promise<void> {
  // Resolve Node built-ins only when Next evaluates its config. Keeping them
  // out of the static module graph prevents Turbopack's route tracer from
  // treating this config-time hook as an application runtime dependency.
  const { spawn } = process.getBuiltinModule(
    "node:child_process"
  ) as typeof import("node:child_process");
  const { fileURLToPath } = process.getBuiltinModule(
    "node:url"
  ) as typeof import("node:url");
  const cliEntry = fileURLToPath(new URL("../bin.js", import.meta.url));
  const args = [cliEntry, "build"];
  if (options.entry !== undefined) args.push("--entry", options.entry);
  if (options.mcpDir !== undefined) args.push("--mcp-dir", options.mcpDir);
  if (options.viewsDir !== undefined)
    args.push("--views-dir", options.viewsDir);

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `mcp-use build failed${code === null ? ` with signal ${signal}` : ` with exit code ${code}`}.`
        )
      );
    });
  });
}

/** @internal Exported for focused composition tests, not from `mcp-use/next`. */
export function composeNextConfig<T extends NextConfigLike>(
  nextConfig: T,
  basePath: string
): T & NextConfigLike {
  const source = `${basePath}/:path*`;
  const originalHeaders = nextConfig.headers?.bind(nextConfig);
  const existingTrace = nextConfig.outputFileTracingIncludes ?? {};
  const routeTrace = existingTrace[basePath] ?? [];

  return {
    ...nextConfig,
    async headers(): Promise<NextHeaderRule[]> {
      const rules =
        originalHeaders === undefined ? [] : await originalHeaders();
      const matchingIndex = rules.findIndex((rule) => rule.source === source);
      if (matchingIndex === -1) {
        return [...rules, { source, headers: MCP_CORS_HEADERS }];
      }
      return rules.map((rule, index) =>
        index === matchingIndex
          ? { ...rule, headers: mergeHeaders(rule.headers, MCP_CORS_HEADERS) }
          : rule
      );
    },
    outputFileTracingIncludes: {
      ...existingTrace,
      [basePath]: [...new Set([...routeTrace, BUILD_TRACE_GLOB])],
    },
  };
}

/**
 * Add mcp-use build, CORS, and serverless tracing to a Next.js config.
 *
 * The MCP build runs when Next evaluates `next.config`, for both development
 * and production builds. This removes the need for a separate prebuild script.
 */
export async function withMcpUse<T extends NextConfigLike = NextConfigLike>(
  nextConfig: T = {} as T,
  options: WithMcpUseOptions = {}
): Promise<T & NextConfigLike> {
  const basePath = normalizeBasePath(options.basePath);
  const projectRoot = options.projectRoot ?? process.cwd();
  // Build in a separate process so the Vite view compiler never becomes part
  // of the module graph imported by a Next.js Route Handler.
  await buildMcpProject(projectRoot, options);
  return composeNextConfig(nextConfig, basePath);
}
