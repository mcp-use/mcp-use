#!/usr/bin/env node
/**
 * Generates schema/mcp-use.v1.json from the Zod config schema, so editors can
 * validate and autocomplete `mcp-use.json` against the hosted URL.
 *
 * Run with tsx so the TypeScript schema source can be imported directly:
 *   pnpm --filter mcp-use generate:config-schema
 *
 * Keep this in sync after any change to src/server/config/schema.ts.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  configSchema,
  CONFIG_SCHEMA_URL,
} from "../src/server/config/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "../schema/mcp-use.v1.json");

// `io: "input"` keeps optional/defaulted fields non-required in the published
// schema, matching the on-disk shape authors actually write.
const jsonSchema = z.toJSONSchema(configSchema, { io: "input" });

const document = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_URL,
  title: "mcp-use project config",
  description:
    "Configuration for an mcp-use project (mcp-use.json). Generated from the Zod schema in src/server/config/schema.ts.",
  ...jsonSchema,
};

writeFileSync(outputPath, JSON.stringify(document, null, 2) + "\n");

console.log(`Wrote ${outputPath}`);
