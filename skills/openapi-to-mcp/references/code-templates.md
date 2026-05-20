# Code templates

Copy-ready skeletons. Adapt names and paths to the actual project but keep the shape — these templates compile together and any single-file rewrite usually breaks the others.

## Table of contents

1. `package.json` additions
2. `.env.example`
3. `tsconfig.json` (if missing)
4. `scripts/load-spec.ts`
5. `src/operations.ts`
6. `src/schema.ts`
7. `src/auth.ts`
8. `src/client.ts`
9. `index.ts`

---

## 1. `package.json` additions

The `blank` template ships with `mcp-use`, `react`/`react-dom`/`react-router`/`tailwindcss` (used only if you add widgets later), `zod`, `tsx`, `typescript`, and `@types/node` already installed. Scripts `dev`, `build`, `start`, and `deploy` are already wired to `mcp-use`.

Add only what's missing:

```jsonc
{
  "dependencies": {
    "@apidevtools/swagger-parser": "^10.1.1",
    "dotenv": "^16.4.0"
    // mcp-use and zod are already in the scaffold
  },
  "scripts": {
    // keep dev, build, start, deploy from the scaffold; just add this one:
    "load-spec": "tsx scripts/load-spec.ts"
  }
}
```

Install: `npm install @apidevtools/swagger-parser dotenv`. Don't reinstall `zod` or `tsx` — they're already there and version-mismatching them against the mcp-use peer dep will produce confusing errors.

## 2. `.env.example`

Commit this file. Never commit `.env`. Add `.env` to `.gitignore`.

```dotenv
# Base URL of the API (from openapi.yaml `servers[0].url` — override per environment)
BASE_URL=https://api.example.com

# Auth — uncomment whichever the spec declares
# API_KEY=replace-me
# BEARER_TOKEN=replace-me
# BASIC_USER=user
# BASIC_PASS=pass

# Optional: log every outgoing request (use only for debugging)
DEBUG_HTTP=0
```

## 3. `tsconfig.json`

The `@latest` scaffold already ships a working `tsconfig.json` with `moduleResolution: "bundler"`, `@types/node` available, and the right `include` paths for `index.ts` + `src/**/*`. Leave it alone — no edits needed.

## 4. `scripts/load-spec.ts`

Dereferences the spec once, writes the result to disk. Run manually whenever `openapi.yaml` changes.

```ts
import SwaggerParser from "@apidevtools/swagger-parser";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2] ?? "openapi.yaml";
const output = process.argv[3] ?? "openapi.dereferenced.json";

const spec = await SwaggerParser.dereference(resolve(input));
writeFileSync(resolve(output), JSON.stringify(spec, null, 2));
console.log(`Dereferenced ${input} → ${output}`);
```

Run: `npm run load-spec` (or `tsx scripts/load-spec.ts <input> <output>` for non-defaults).

## 5. `src/operations.ts`

Loads the dereferenced spec and produces a clean, normalized list of operations. Downstream code never touches raw OpenAPI again.

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type OperationMeta = {
  operationId: string;       // normalized snake_case
  toolName: string;          // = operationId (or fallback)
  description: string;
  method: "get" | "post" | "put" | "patch" | "delete" | "head" | "options";
  path: string;              // raw OpenAPI path with {placeholders}
  parameters: any[];         // OpenAPI parameter objects
  requestBody?: any;
  responses: Record<string, any>;
  security?: any[];
  tags?: string[];
  deprecated?: boolean;
};

const SPEC_PATH = resolve("openapi.dereferenced.json");
const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function toSnakeCase(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function deriveOperationId(method: string, path: string): string {
  return toSnakeCase(`${method}_${path}`);
}

function buildOperations(): OperationMeta[] {
  const ops: OperationMeta[] = [];
  const seen = new Set<string>();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;

    for (const method of METHODS) {
      const op = (pathItem as any)[method];
      if (!op) continue;

      const rawId = op.operationId ?? deriveOperationId(method, path);
      let toolName = toSnakeCase(rawId);
      if (seen.has(toolName)) {
        toolName = `${toolName}_${method}`;
        console.warn(`[ops] Name collision; renamed to ${toolName}`);
      }
      seen.add(toolName);

      const summary = op.summary?.trim() ?? "";
      const description = op.description?.trim() ?? "";
      const tags = op.tags ?? [];
      const tagLine = tags.length ? `[Tags: ${tags.join(", ")}]` : "";
      const desc =
        [summary, description, tagLine].filter(Boolean).join("\n\n") ||
        `${method.toUpperCase()} ${path}`;

      ops.push({
        operationId: rawId,
        toolName,
        description: desc,
        method,
        path,
        parameters: op.parameters ?? [],
        requestBody: op.requestBody,
        responses: op.responses ?? {},
        security: op.security ?? spec.security,
        tags,
        deprecated: op.deprecated === true,
      });
    }
  }

  return ops;
}

export const operations: OperationMeta[] = buildOperations();
export type { OperationMeta };
```

## 6. `src/schema.ts`

OpenAPI schema → zod converter. Recursive. Handles the cases from `references/mapping-rules.md`.

```ts
import { z, ZodTypeAny } from "zod";
import type { OperationMeta } from "./operations";

export function schemaToZod(schema: any): ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.unknown();

  // Combinators
  if (Array.isArray(schema.oneOf)) {
    return z.union(schema.oneOf.map(schemaToZod) as any);
  }
  if (Array.isArray(schema.anyOf)) {
    return z.union(schema.anyOf.map(schemaToZod) as any);
  }
  if (Array.isArray(schema.allOf)) {
    // Merge object-only allOf
    const merged = schema.allOf.reduce((acc: any, sub: any) => {
      if (sub.type === "object" || sub.properties) {
        return {
          ...acc,
          type: "object",
          properties: { ...(acc.properties ?? {}), ...(sub.properties ?? {}) },
          required: [...(acc.required ?? []), ...(sub.required ?? [])],
        };
      }
      return acc;
    }, {} as any);
    return schemaToZod(merged);
  }

  // Type-based dispatch
  const type = Array.isArray(schema.type)
    ? schema.type.find((t: string) => t !== "null")
    : schema.type;
  const nullable = schema.nullable || (Array.isArray(schema.type) && schema.type.includes("null"));

  let base: ZodTypeAny;
  switch (type) {
    case "string":
      base = stringSchema(schema);
      break;
    case "integer":
      base = numberSchema(schema, true);
      break;
    case "number":
      base = numberSchema(schema, false);
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array":
      base = arraySchema(schema);
      break;
    case "object":
      base = objectSchema(schema);
      break;
    default:
      base = schema.properties ? objectSchema(schema) : z.unknown();
  }

  if (nullable) base = base.nullable();
  if (schema.default !== undefined) base = base.default(schema.default);
  const desc = schema.description ?? schema.title;
  if (desc) base = base.describe(desc);

  return base;
}

function stringSchema(s: any): ZodTypeAny {
  if (Array.isArray(s.enum) && s.enum.length) return z.enum(s.enum as [string, ...string[]]);
  let v = z.string();
  // zod v4: datetime() type signature differs from v3; cast to keep the assign loop happy
  if (s.format === "date-time") v = (v as any).datetime() as typeof v;
  if (s.format === "email") v = v.email();
  if (s.format === "uri" || s.format === "url") v = v.url();
  if (s.format === "uuid") v = v.uuid();
  if (typeof s.minLength === "number") v = v.min(s.minLength);
  if (typeof s.maxLength === "number") v = v.max(s.maxLength);
  if (s.pattern) v = v.regex(new RegExp(s.pattern));
  return v;
}

function numberSchema(s: any, isInt: boolean): ZodTypeAny {
  let v = isInt ? z.number().int() : z.number();
  if (typeof s.minimum === "number") v = v.gte(s.minimum);
  if (typeof s.maximum === "number") v = v.lte(s.maximum);
  if (typeof s.multipleOf === "number") v = v.multipleOf(s.multipleOf);
  return v;
}

function arraySchema(s: any): ZodTypeAny {
  let v = z.array(schemaToZod(s.items ?? {}));
  if (typeof s.minItems === "number") v = v.min(s.minItems);
  if (typeof s.maxItems === "number") v = v.max(s.maxItems);
  return v;
}

function objectSchema(s: any): ZodTypeAny {
  const props = s.properties ?? {};
  const required = new Set<string>(s.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, sub] of Object.entries(props)) {
    let v = schemaToZod(sub);
    if (!required.has(key)) v = v.optional();
    shape[key] = v;
  }
  let obj: ZodTypeAny = z.object(shape);
  if (s.additionalProperties && typeof s.additionalProperties === "object") {
    // zod v4: record requires explicit key type
    obj = z.record(z.string(), schemaToZod(s.additionalProperties));
  }
  return obj;
}

// Merge path + query + body into one flat zod object for the tool schema.
export function operationToZod(op: OperationMeta): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};

  for (const p of op.parameters) {
    if (p.in === "cookie") continue;
    const key = p.in === "header" ? `header_${toSnake(p.name)}` : p.name;
    let v = schemaToZod(p.schema ?? {});
    if (p.description) v = v.describe(p.description);
    if (!p.required) v = v.optional();
    shape[key] = v;
  }

  const json = op.requestBody?.content?.["application/json"]?.schema;
  if (json) {
    if (json.type === "object" && json.properties) {
      const required = new Set<string>(json.required ?? []);
      for (const [key, sub] of Object.entries(json.properties)) {
        const fieldKey = key in shape ? `body_${key}` : key;
        let v = schemaToZod(sub);
        if (!required.has(key)) v = v.optional();
        shape[fieldKey] = v;
      }
    } else {
      shape["body"] = schemaToZod(json);
    }
  }

  return z.object(shape);
}

function toSnake(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}
```

## 7. `src/auth.ts`

Reads the spec's `securitySchemes`, builds a header map. See `references/auth.md` for scheme-by-scheme detail.

```ts
import { readFileSync } from "node:fs";

const spec = JSON.parse(readFileSync("openapi.dereferenced.json", "utf8"));

type AuthHeaders = Record<string, string>;

export function buildAuthHeaders(): AuthHeaders {
  const headers: AuthHeaders = {};
  const schemes = spec.components?.securitySchemes ?? {};

  for (const [name, scheme] of Object.entries<any>(schemes)) {
    if (scheme.type === "apiKey" && scheme.in === "header") {
      const value = process.env[envVarFor(name)];
      if (value) headers[scheme.name] = value;
    } else if (scheme.type === "http" && scheme.scheme === "bearer") {
      const token = process.env.BEARER_TOKEN ?? process.env[envVarFor(name)];
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } else if (scheme.type === "http" && scheme.scheme === "basic") {
      const user = process.env.BASIC_USER;
      const pass = process.env.BASIC_PASS;
      if (user && pass) headers["Authorization"] = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    } else if (scheme.type === "oauth2") {
      // OAuth2 access tokens come in as bearer
      const token = process.env.BEARER_TOKEN ?? process.env.OAUTH_ACCESS_TOKEN;
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return headers;
}

// `securitySchemes.MyKey` → process.env.MY_KEY (used when the user-friendly name in .env follows the scheme name)
function envVarFor(schemeName: string): string {
  return schemeName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}
```

## 8. `src/client.ts`

```ts
import { operations, OperationMeta } from "./operations";
import { buildAuthHeaders } from "./auth";

const BASE_URL = process.env.BASE_URL ?? defaultBaseUrl();
const DEBUG = process.env.DEBUG_HTTP === "1";

function defaultBaseUrl(): string {
  const spec = JSON.parse(require("node:fs").readFileSync("openapi.dereferenced.json", "utf8"));
  return spec.servers?.[0]?.url ?? "http://localhost";
}

export async function callOperation(
  operationId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const op = operations.find((o) => o.operationId === operationId || o.toolName === operationId);
  if (!op) throw new Error(`Unknown operation: ${operationId}`);

  // Substitute path params
  let path = op.path;
  const usedKeys = new Set<string>();
  for (const p of op.parameters) {
    if (p.in === "path") {
      const value = args[p.name];
      if (value === undefined) throw new Error(`Missing path param: ${p.name}`);
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(value)));
      usedKeys.add(p.name);
    }
  }

  // Build URL with query params
  const url = new URL(joinUrl(BASE_URL, path));
  for (const p of op.parameters) {
    if (p.in === "query") {
      const value = args[p.name];
      if (value !== undefined && value !== null) {
        url.searchParams.set(p.name, String(value));
        usedKeys.add(p.name);
      }
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...buildAuthHeaders(),
  };
  for (const p of op.parameters) {
    if (p.in === "header") {
      const key = `header_${p.name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`;
      const value = args[key];
      if (value !== undefined) {
        headers[p.name] = String(value);
        usedKeys.add(key);
      }
    }
  }

  // Build body (everything not used as path/query/header)
  let body: string | undefined;
  if (op.requestBody) {
    const json = op.requestBody.content?.["application/json"]?.schema;
    if (json) {
      const bodyObj: Record<string, unknown> = {};
      if (json.type === "object" && json.properties) {
        for (const key of Object.keys(json.properties)) {
          if (!usedKeys.has(key) && args[key] !== undefined) {
            bodyObj[key] = args[key];
          }
        }
        body = JSON.stringify(bodyObj);
      } else if (args["body"] !== undefined) {
        body = JSON.stringify(args["body"]);
      }
    }
  }

  if (DEBUG) console.log(`→ ${op.method.toUpperCase()} ${url.toString()}`, headers, body);

  const res = await fetch(url, {
    method: op.method.toUpperCase(),
    headers,
    body,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`);
}
```

## 9. `index.ts`

Replace the scaffolded `index.ts` with this — preserving the MCPServer fields the scaffold gave you (title, baseUrl, favicon, icons) and adding the OpenAPI tool registration loop in place of the commented examples.

```ts
import "dotenv/config";              // load .env into process.env
import { MCPServer, text } from "mcp-use/server";
import { operations } from "./src/operations";
import { callOperation } from "./src/client";
import { operationToZod } from "./src/schema";

const server = new MCPServer({
  name: "openapi-mcp",                // replace with the API's name (lowercase, hyphenated)
  title: "OpenAPI MCP",
  version: "1.0.0",
  description: "MCP server wrapping the <API name> REST API",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
  favicon: "favicon.ico",
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["512x512"] }],
});

for (const op of operations) {
  // Optional filter — uncomment to limit which operations become tools
  // if (!["pets", "users"].some((t) => op.tags?.includes(t))) continue;
  // if (op.deprecated) continue;

  server.tool(
    {
      name: op.toolName,
      description: op.description,
      schema: operationToZod(op),
    },
    async (args: any) => {
      try {
        const result = await callOperation(op.operationId, args);
        return text(typeof result === "string" ? result : JSON.stringify(result, null, 2));
      } catch (e: any) {
        return text(`Error calling ${op.toolName}: ${e.message}`);
      }
    },
  );
}

// Transport: streamable HTTP at /mcp. Do NOT swap for stdio — see SKILL.md step 8.
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(port);
console.log(`MCP:       http://localhost:${port}/mcp`);
console.log(`Inspector: http://localhost:${port}/inspector`);
```

Two practical notes:

- The scaffold uses `process.env.MCP_URL` for the **MCP server's own public base URL** (asset serving, widget resolution). That's distinct from your upstream API base URL (`BASE_URL`). Don't conflate them.
- `import "dotenv/config"` requires `npm install dotenv` (covered in section 1). If you'd rather avoid the dep, the scaffold's `npm run dev` runs through `mcp-use dev`, which loads `.env` automatically — `dotenv` is only strictly needed if you run the helper script `scripts/load-spec.ts` directly with `tsx`, since it doesn't go through the `mcp-use` CLI.

---

That's the whole server. Everything beyond this is iteration on:
- which operations to expose (filter at the loop),
- which env vars to require (edit `.env.example` + `src/auth.ts`),
- how to handle non-JSON content types (extend `src/client.ts`).
