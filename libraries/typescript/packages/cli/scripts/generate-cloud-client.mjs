#!/usr/bin/env node
/**
 * Generate Cloud API types and the fake Cloud's route map.
 *
 *   pnpm --filter @mcp-use/cli generate:cloud-client <openapi.json>
 *
 * The document is an input only. Only the operations below and their
 * referenced schemas reach the type generator; no spec snapshot or client
 * runtime is written. Review generated types before committing them.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";
import { format } from "prettier";

const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
const input = process.argv[2];
if (input === undefined) {
  console.error(
    "Usage: pnpm --filter @mcp-use/cli generate:cloud-client <openapi.json>"
  );
  process.exit(2);
}
const OUTPUT = `${PACKAGE_DIR}src/cloud/api/generated`;
const ROUTES = `${PACKAGE_DIR}tests/helpers/cloud-routes.gen.ts`;

/** Add an operation in the same change as the command that calls it. */
const OPERATIONS = [
  "GET /api/auth/get-session",
  "POST /api/auth/api-key/create",
  "POST /api/auth/api-key/delete",
  "GET /api/v1/organizations",
  "GET /api/v1/user-preferences",
  "GET /api/v1/deployments",
  "POST /api/v1/deployments",
  "GET /api/v1/deployments/{id}",
  "GET /api/v1/deployments/{id}/build-logs",
  "GET /api/v1/deployments/{id}/logs",
  "GET /api/v1/servers",
  "GET /api/v1/servers/{id}",
];

/**
 * Success fields needed by the CLI, as dotted paths (`items[].id` steps
 * into an array). Unlisted operations retain their full success response.
 * This limits generated declarations; it does not filter HTTP responses.
 */
const RESPONSE_FIELDS = {
  "GET /api/auth/get-session": ["user.email"],
  "POST /api/auth/api-key/create": ["id", "key", "name"],
  "POST /api/auth/api-key/delete": ["success"],
  "GET /api/v1/organizations": [
    "organizations[].id",
    "organizations[].name",
    "organizations[].slug",
    "organizations[].role",
  ],
  "GET /api/v1/user-preferences": ["defaultOrganizationId"],
  "GET /api/v1/servers": [
    "items[].id",
    "items[].slug",
    "items[].name",
    "items[].organizationId",
    "total",
    "limit",
    "skip",
  ],
  "GET /api/v1/servers/{id}": ["id", "slug", "name", "organizationId"],
};

const spec = JSON.parse(await readFile(resolve(process.cwd(), input), "utf8"));
for (const [key, fields] of Object.entries(RESPONSE_FIELDS)) {
  if (!OPERATIONS.includes(key))
    throw new Error(
      `RESPONSE_FIELDS lists ${key}, which is not in OPERATIONS.`
    );
  const space = key.indexOf(" ");
  const operation =
    spec.paths[key.slice(space + 1)]?.[key.slice(0, space).toLowerCase()];
  for (const [status, response] of Object.entries(operation?.responses ?? {})) {
    const content = resolveRef(response).content?.["application/json"];
    if (Number(status) >= 200 && Number(status) < 300 && content?.schema) {
      content.schema = keepFields(content.schema, fields, `${key} ${status}`);
    }
  }
}

const scoped = {
  openapi: spec.openapi,
  info: { title: "Manufact Cloud CLI", version: "1" },
  paths: {},
  components: {},
};
const operations = OPERATIONS.map((key) => {
  const space = key.indexOf(" ");
  const method = key.slice(0, space).toLowerCase();
  const path = key.slice(space + 1);
  const item = spec.paths[path];
  const operation = item?.[method];
  if (operation === undefined || typeof operation.operationId !== "string") {
    throw new Error(`The OpenAPI document has no operationId for ${key}.`);
  }
  scoped.paths[path] ??= {};
  if (item.parameters) scoped.paths[path].parameters = item.parameters;
  scoped.paths[path][method] = operation;
  const statuses = Object.keys(operation.responses ?? {})
    .map(Number)
    .filter(Number.isInteger);
  const success = statuses
    .filter((status) => status >= 200 && status < 300)
    .sort((a, b) => a - b);
  return {
    key,
    operationId: operation.operationId,
    success,
    errors: statuses.filter((status) => status >= 400),
    successStatus: success[0] ?? 200,
  };
}).sort((a, b) => a.key.localeCompare(b.key));

// Copy only reachable components, including references reached transitively.
// Passing the full components table would publish unrelated declarations.
const visited = new Set();
function includeReferences(value) {
  if (value === null || typeof value !== "object") return;
  if (typeof value.$ref === "string") {
    const ref = value.$ref;
    const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref);
    if (match === null) throw new Error(`Unsupported reference: ${ref}`);
    if (!visited.has(ref)) {
      visited.add(ref);
      const [, group, encodedName] = match;
      const name = encodedName.replaceAll("~1", "/").replaceAll("~0", "~");
      const component = spec.components?.[group]?.[name];
      if (component === undefined) throw new Error(`Missing reference: ${ref}`);
      scoped.components[group] ??= {};
      scoped.components[group][name] = component;
      includeReferences(component);
    }
  }
  for (const child of Object.values(value)) includeReferences(child);
}
includeReferences(scoped.paths);

const types = astToString(await openapiTS(scoped, { silent: true }));
await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
await writeFile(`${OUTPUT}/types.gen.ts`, types);

const lines = [];
for (const { key, operationId, success, errors } of operations) {
  const operation = `T.operations[${JSON.stringify(operationId)}]`;
  const bodies = (statuses) =>
    statuses.length === 0
      ? "Record<never, never>"
      : `{ ${statuses.map((status) => `${status}: ResponseBody<${operation}["responses"][${status}]>`).join("; ")} }`;
  lines.push(
    `  ${JSON.stringify(key)}: {`,
    `    data: ${operation}["parameters"];`,
    `    responses: ${bodies(success)};`,
    `    errors: ${bodies(errors)};`,
    "  };"
  );
}
await writeFile(
  ROUTES,
  await format(
    [
      "// Generated by scripts/generate-cloud-client.mjs. Do not edit.",
      'import type * as T from "../../src/cloud/api/generated/types.gen.js";',
      "",
      "type ResponseBody<R> = R extends { content: infer C } ? C[keyof C] : void;",
      "",
      "export interface CloudRoutes {",
      ...lines,
      "}",
      "",
      "/** Route templates used by the fake Cloud at runtime. */",
      "export const cloudRouteKeys: readonly (keyof CloudRoutes)[] = [",
      ...operations.map(({ key }) => `  ${JSON.stringify(key)},`),
      "];",
      "",
      "/** Documented default success status for each route. */",
      "export const cloudRouteSuccessStatus: Readonly<Record<keyof CloudRoutes, number>> = {",
      ...operations.map(
        ({ key, successStatus }) =>
          `  ${JSON.stringify(key)}: ${successStatus},`
      ),
      "};",
      "",
    ].join("\n"),
    { parser: "typescript" }
  )
);
console.log(`Generated types for ${operations.length} Cloud operations.`);

/** Keep selected success fields, failing if a field was renamed or removed. */
function keepFields(schema, paths, where) {
  const resolved = resolveRef(schema);
  if (resolved.type === "array" || resolved.items !== undefined) {
    return {
      ...resolved,
      items: keepFields(
        resolved.items,
        paths.map((path) => path.replace(/^\[\]\.?/, "")),
        `${where}[]`
      ),
    };
  }
  const properties = resolved.properties ?? {};
  const kept = {};
  const byName = new Map();
  for (const path of paths) {
    const match = /^([^.[]+)(.*)$/.exec(path);
    if (match === null) throw new Error(`Bad field path ${path} in ${where}.`);
    const [, name, rest] = match;
    if (!(name in properties))
      throw new Error(`${where} has no field ${name}.`);
    const nested = rest.replace(/^\./, "");
    if (!byName.has(name)) byName.set(name, []);
    if (nested !== "") byName.get(name).push(nested);
  }
  for (const [name, nested] of byName) {
    kept[name] =
      nested.length === 0
        ? properties[name]
        : keepFields(properties[name], nested, `${where}.${name}`);
  }
  return {
    ...resolved,
    properties: kept,
    ...(resolved.required !== undefined
      ? { required: resolved.required.filter((name) => name in kept) }
      : {}),
  };
}

function resolveRef(schema) {
  let current = schema;
  const seen = new Set();
  while (current?.$ref !== undefined) {
    const ref = current.$ref;
    if (seen.has(ref))
      throw new Error(`Circular reference while selecting fields: ${ref}`);
    seen.add(ref);
    if (!ref.startsWith("#/")) throw new Error(`Unsupported reference: ${ref}`);
    current = ref
      .slice(2)
      .split("/")
      .reduce(
        (node, key) => node?.[key.replaceAll("~1", "/").replaceAll("~0", "~")],
        spec
      );
    if (current === undefined) throw new Error(`Missing reference: ${ref}`);
  }
  return current;
}
