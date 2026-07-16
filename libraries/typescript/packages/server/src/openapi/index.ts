import {
  fromJsonSchema,
  type CallToolResult,
  type JSONValue,
  type JsonSchemaType,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

import type { MCPServer } from "../server.js";
import type {
  CollectedOpenAPIOperation,
  FromOpenAPIOptions,
  OpenAPIDocument,
  OpenAPIExcludeRule,
  OpenAPIHttpMethod,
  OpenAPIOperationObject,
  OpenAPIParameterObject,
  OpenAPIPathItemObject,
  OpenAPIReferenceObject,
  OpenAPIRequestBodyObject,
  OpenAPISchemaObject,
} from "./types.js";

export type {
  FromOpenAPIOptions,
  OpenAPIAuth,
  OpenAPIDocument,
  OpenAPIExcludeRule,
} from "./types.js";

const HTTP_METHODS: OpenAPIHttpMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

/**
 * Register every included operation in a bundled OpenAPI document as an MCP
 * tool on an existing server.
 *
 * @internal
 */
export function registerOpenAPITools(
  server: Pick<MCPServer, "tool">,
  options: FromOpenAPIOptions
): void {
  const operations = collectOperations(options.spec, options);
  const names = createToolNames(operations);

  for (const [index, operation] of operations.entries()) {
    const name = names[index];
    if (name === undefined) continue;

    server.tool(
      {
        name,
        description: createToolDescription(operation),
        inputSchema: createToolInputSchema(options.spec, operation),
      },
      async (params) => callOpenAPIOperation(operation, params, options)
    );
  }
}

function collectOperations(
  spec: OpenAPIDocument,
  options: Pick<FromOpenAPIOptions, "tags" | "exclude">
): CollectedOpenAPIOperation[] {
  const collected: CollectedOpenAPIOperation[] = [];

  for (const [path, pathItemOrRef] of Object.entries(spec.paths ?? {})) {
    const pathItem = resolveRef<OpenAPIPathItemObject>(spec, pathItemOrRef);
    if (pathItem === undefined || isReferenceObject(pathItem)) continue;

    const pathParameters = resolveParameters(spec, pathItem.parameters);

    for (const method of HTTP_METHODS) {
      const operationOrRef = pathItem[method];
      if (operationOrRef === undefined) continue;

      const operation = resolveRef<OpenAPIOperationObject>(
        spec,
        operationOrRef
      );
      if (operation === undefined || isReferenceObject(operation)) continue;

      const operationParameters = resolveParameters(spec, operation.parameters);
      const requestBody =
        operation.requestBody === undefined
          ? undefined
          : resolveRef<OpenAPIRequestBodyObject>(spec, operation.requestBody);

      const item: CollectedOpenAPIOperation = {
        method,
        path,
        operation,
        parameters: mergeParameters(pathParameters, operationParameters),
        ...(requestBody !== undefined &&
          !isReferenceObject(requestBody) && { requestBody }),
      };

      if (isIncluded(item, options)) collected.push(item);
    }
  }

  return collected;
}

function resolveParameters(
  spec: OpenAPIDocument,
  parameters?: Array<OpenAPIParameterObject | OpenAPIReferenceObject>
): OpenAPIParameterObject[] {
  const resolved: OpenAPIParameterObject[] = [];
  for (const parameter of parameters ?? []) {
    const value = resolveRef<OpenAPIParameterObject>(spec, parameter);
    if (value !== undefined && !isReferenceObject(value)) resolved.push(value);
  }
  return resolved;
}

function mergeParameters(
  pathParameters: OpenAPIParameterObject[],
  operationParameters: OpenAPIParameterObject[]
): OpenAPIParameterObject[] {
  const merged = new Map<string, OpenAPIParameterObject>();
  for (const parameter of [...pathParameters, ...operationParameters]) {
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...merged.values()];
}

function isIncluded(
  operation: CollectedOpenAPIOperation,
  options: Pick<FromOpenAPIOptions, "tags" | "exclude">
): boolean {
  if (options.tags?.length) {
    const tags = new Set(operation.operation.tags ?? []);
    if (!options.tags.some((tag) => tags.has(tag))) return false;
  }

  return !(options.exclude ?? []).some((rule) =>
    matchesExcludeRule(operation, rule)
  );
}

function matchesExcludeRule(
  operation: CollectedOpenAPIOperation,
  rule: OpenAPIExcludeRule
): boolean {
  if (rule.method && rule.method.toLowerCase() !== operation.method) {
    return false;
  }
  if (
    rule.operationId &&
    !matchesPattern(rule.operationId, operation.operation.operationId ?? "")
  ) {
    return false;
  }
  if (rule.path && !matchesPattern(rule.path, operation.path)) return false;
  if (rule.tags?.length) {
    const tags = new Set(operation.operation.tags ?? []);
    if (!rule.tags.some((tag) => tags.has(tag))) return false;
  }
  return true;
}

function matchesPattern(pattern: string | RegExp, value: string): boolean {
  if (typeof pattern === "string") return pattern === value;
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function createToolNames(operations: CollectedOpenAPIOperation[]): string[] {
  const seen = new Map<string, number>();
  return operations.map((operation) => {
    const baseName = slugifyToolName(
      operation.operation.operationId ??
        `${operation.method}_${operation.path
          .replace(/[{}]/g, "")
          .replace(/\//g, "_")}`
    );
    const count = seen.get(baseName) ?? 0;
    seen.set(baseName, count + 1);
    return count === 0 ? baseName : `${baseName}_${count + 1}`;
  });
}

function createToolDescription(operation: CollectedOpenAPIOperation): string {
  return [
    operation.operation.summary,
    operation.operation.description,
    `HTTP: ${operation.method.toUpperCase()} ${operation.path}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function slugifyToolName(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_/, "")
    .replace(/_$/, "")
    .slice(0, 64);
  return slug || "openapi_tool";
}

function createToolInputSchema(
  spec: OpenAPIDocument,
  operation: CollectedOpenAPIOperation
): StandardSchemaWithJSON<Record<string, unknown>, Record<string, unknown>> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of operation.parameters) {
    if (parameter.in === "cookie") continue;

    const parameterSchema = transformSchema(
      spec,
      parameter.schema ?? ({} satisfies OpenAPISchemaObject)
    );
    properties[parameter.name] = {
      ...parameterSchema,
      description: parameter.description ?? `${parameter.in} parameter`,
    };
    if (parameter.required || parameter.in === "path") {
      required.push(parameter.name);
    }
  }

  const bodySchema = getJsonRequestBodySchema(operation.requestBody);
  if (bodySchema !== undefined) {
    properties["body"] = transformSchema(spec, bodySchema);
    if (operation.requestBody?.required) required.push("body");
  }

  const definitions = createSchemaDefinitions(spec);
  const schema = {
    type: "object",
    properties,
    additionalProperties: false,
    ...(required.length > 0 && { required }),
    ...(definitions !== undefined && { $defs: definitions }),
  };

  return fromJsonSchema<Record<string, unknown>>(schema as JsonSchemaType);
}

function createSchemaDefinitions(
  spec: OpenAPIDocument
): Record<string, unknown> | undefined {
  const schemas = readRecord(spec.components?.["schemas"]);
  if (schemas === undefined) return undefined;

  const definitions: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    definitions[name] = transformSchemaNode(spec, schema, new Set());
  }
  return definitions;
}

function transformSchema(
  spec: OpenAPIDocument,
  schema: OpenAPISchemaObject | OpenAPIReferenceObject
): Record<string, unknown> {
  const transformed = transformSchemaNode(spec, schema, new Set());
  return readRecord(transformed) ?? {};
}

function transformSchemaNode(
  spec: OpenAPIDocument,
  value: unknown,
  resolvingRefs: Set<string>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformSchemaNode(spec, item, resolvingRefs));
  }
  const object = readRecord(value);
  if (object === undefined) return value;

  const ref = typeof object["$ref"] === "string" ? object["$ref"] : undefined;
  const siblings: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    if (key === "$ref") continue;
    if (key === "nullable" && typeof child === "boolean") continue;
    siblings[key] = transformSchemaNode(spec, child, resolvingRefs);
  }

  let transformed: Record<string, unknown> = siblings;
  if (ref !== undefined) {
    const schemaRef = rewriteSchemaRef(spec, ref);
    if (schemaRef !== undefined) {
      transformed = { $ref: schemaRef, ...siblings };
    } else if (!resolvingRefs.has(ref)) {
      const resolved = resolveRef<unknown>(spec, { $ref: ref });
      if (resolved !== undefined) {
        const nextRefs = new Set(resolvingRefs);
        nextRefs.add(ref);
        transformed = {
          ...(readRecord(transformSchemaNode(spec, resolved, nextRefs)) ?? {}),
          ...siblings,
        };
      }
    }
  }

  if (object["nullable"] === true) {
    return { anyOf: [transformed, { type: "null" }] };
  }
  return transformed;
}

function rewriteSchemaRef(
  spec: OpenAPIDocument,
  ref: string
): string | undefined {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return undefined;
  return resolveRef<unknown>(spec, { $ref: ref }) === undefined
    ? undefined
    : `#/$defs/${ref.slice(prefix.length)}`;
}

function getJsonRequestBodySchema(
  requestBody: OpenAPIRequestBodyObject | undefined
): OpenAPISchemaObject | OpenAPIReferenceObject | undefined {
  const content = requestBody?.content;
  if (content === undefined) return undefined;
  return (
    content["application/json"]?.schema ??
    content["application/*+json"]?.schema ??
    Object.entries(content).find(([mediaType]) =>
      mediaType.includes("+json")
    )?.[1].schema
  );
}

async function callOpenAPIOperation(
  operation: CollectedOpenAPIOperation,
  params: Record<string, unknown>,
  options: FromOpenAPIOptions
): Promise<CallToolResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const url = buildUrl(operation, params, options);
  const headers = buildHeaders(operation.parameters, params, options);
  const body =
    params["body"] === undefined ? undefined : JSON.stringify(params["body"]);

  if (body !== undefined && !hasHeader(headers, "content-type")) {
    headers["content-type"] = "application/json";
  }

  const response = await fetchImpl(url, {
    method: operation.method.toUpperCase(),
    headers,
    ...(body !== undefined && { body }),
  });
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    return {
      content: [{ type: "text", text: await response.text() }],
      isError: true,
    };
  }
  if (
    contentType.includes("application/json") ||
    contentType.includes("+json")
  ) {
    const data = (await response.json()) as JSONValue;
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
  return { content: [{ type: "text", text: await response.text() }] };
}

function buildUrl(
  operation: CollectedOpenAPIOperation,
  params: Record<string, unknown>,
  options: FromOpenAPIOptions
): string {
  const baseUrl = options.baseUrl ?? options.spec.servers?.[0]?.url ?? "";
  const interpolatedPath = operation.path.replace(
    /{([^}]+)}/g,
    (_match, name: string) => encodeURIComponent(String(params[name] ?? ""))
  );
  const url = new URL(
    interpolatedPath.replace(/^\/+/, ""),
    ensureTrailingSlash(baseUrl)
  );

  for (const parameter of operation.parameters) {
    if (parameter.in !== "query") continue;
    const value = params[parameter.name];
    if (value === undefined || value === null || value === "") continue;
    appendQueryParam(url, parameter.name, value);
  }
  return url.toString();
}

function buildHeaders(
  parameters: OpenAPIParameterObject[],
  params: Record<string, unknown>,
  options: FromOpenAPIOptions
): Record<string, string> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  for (const parameter of parameters) {
    if (parameter.in !== "header") continue;
    const value = params[parameter.name];
    if (value === undefined || value === null || value === "") continue;
    headers[parameter.name] = String(value);
  }
  if (options.auth?.type === "bearer" && options.auth.token) {
    headers["authorization"] = `Bearer ${options.auth.token}`;
  }
  if (options.auth?.type === "header" && options.auth.value) {
    headers[options.auth.name] = options.auth.value;
  }
  return headers;
}

function appendQueryParam(url: URL, name: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== undefined && item !== null && item !== "") {
        url.searchParams.append(name, String(item));
      }
    }
    return;
  }
  url.searchParams.set(name, String(value));
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some(
    (headerName) => headerName.toLowerCase() === name
  );
}

function isReferenceObject(value: unknown): value is OpenAPIReferenceObject {
  const object = readRecord(value);
  return object !== undefined && typeof object["$ref"] === "string";
}

function resolveRef<T>(
  spec: OpenAPIDocument,
  value: T | OpenAPIReferenceObject
): T | undefined {
  if (!isReferenceObject(value)) return value;
  if (!value.$ref.startsWith("#/")) return undefined;

  const segments = value.$ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = spec;
  for (const segment of segments) {
    const object = readRecord(current);
    if (object === undefined || !(segment in object)) return undefined;
    current = object[segment];
  }
  return current as T;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
