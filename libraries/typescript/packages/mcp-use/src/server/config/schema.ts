/**
 * Zod schema and TypeScript types for the `mcp-use.json` project config.
 *
 * This is the single source of truth for the on-disk config shape and its
 * defaults. The committed JSON Schema (`schema/mcp-use.v1.json`) is generated
 * from this module — see `scripts/generate-config-schema.mjs` and keep the two
 * in sync by re-running that script after any change here.
 *
 * Design notes:
 * - Top-level keys are validated strictly (`z.strictObject`) so a typo like
 *   `"viewDir"` is rejected with an actionable error instead of being silently
 *   ignored.
 * - Nested objects are also strict per-key, but every field carries a default
 *   so an omitted (or partial) nested object resolves to a fully-populated one.
 * - `$schema` and `version` are accepted; `$schema` is purely advisory (editor
 *   autocomplete) and is preserved verbatim if present.
 */

import { z } from "zod";

/** The hosted JSON Schema URL that config files may point `$schema` at. */
export const CONFIG_SCHEMA_URL = "https://schema.mcp-use.dev/mcp-use.v1.json";

/** The config file name the loader walks up the directory tree to find. */
export const CONFIG_FILE_NAME = "mcp-use.json";

const devSchema = z
  .strictObject({
    port: z.number().int().default(3000),
    host: z.string().default("localhost"),
    openInspector: z.boolean().default(true),
    tunnel: z.boolean().default(false),
  })
  .prefault({});

const buildSchema = z
  .strictObject({
    command: z.string().default("mcp-use build"),
    startCommand: z.string().default("mcp-use start"),
    port: z.number().int().default(3000),
    inline: z.boolean().default(false),
    typecheck: z.boolean().default(true),
  })
  .prefault({});

const cloudSchema = z
  .strictObject({
    serverSlug: z.string().nullable().default(null),
    serverId: z.string().nullable().default(null),
    organization: z.string().nullable().default(null),
    region: z.string().default("AUTO"),
    productionBranch: z.string().default("main"),
    watchPaths: z.array(z.string()).default(["src/**", "resources/**"]),
    deployBranchPatterns: z.array(z.string()).default(["feature/*"]),
    waitForCi: z.boolean().default(false),
  })
  .prefault({});

const envSchema = z
  .strictObject({
    files: z.array(z.string()).default([".env"]),
    syncOnDeploy: z.array(z.string()).default([]),
  })
  .prefault({});

const evalSchema = z
  .strictObject({
    specs: z.array(z.string()).default(["evals/**/*.yaml"]),
    defaultRunner: z.string().default("local"),
    baselineDir: z.string().default("evals/baselines"),
    outputDir: z.string().default(".mcp-use/eval/runs"),
  })
  .prefault({});

/**
 * The full project config schema. Parsing an empty object `{}` yields a fully
 * defaulted {@link ResolvedConfig}.
 */
export const configSchema = z.strictObject({
  // Advisory: points editors at the hosted JSON Schema for autocomplete.
  $schema: z.string().optional(),
  version: z.number().int().default(1),
  name: z.string().optional(),
  // CLI falls back to a filesystem convention when unset; we do NOT resolve
  // that convention here, so this stays optional with no default.
  entry: z.string().optional(),
  viewsDir: z.string().default("resources"),
  publicDir: z.string().default("public"),
  outDir: z.string().default(".mcp-use/build"),
  basePath: z.string().default("/mcp"),
  assetPrefix: z.string().nullable().default(null),
  dev: devSchema,
  build: buildSchema,
  cloud: cloudSchema,
  env: envSchema,
  eval: evalSchema,
});

/**
 * The on-disk config shape: everything optional except as the user chooses to
 * specify. This is what authors of `mcp-use.json` write.
 */
export type McpUseConfig = z.input<typeof configSchema>;

/**
 * The config after Zod has applied defaults. Every modelled field is present;
 * nested objects are fully populated.
 */
export type ResolvedConfig = z.output<typeof configSchema>;
