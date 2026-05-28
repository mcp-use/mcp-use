import { isReferenceObject, resolveRef } from "./refs.js";
import type {
  CollectedOpenAPIOperation,
  FromOpenAPIOptions,
  OpenAPIDocument,
  OpenAPIExcludeRule,
  OpenAPIHttpMethod,
  OpenAPIOperationObject,
  OpenAPIParameterObject,
  OpenAPIPathItemObject,
  OpenAPIRequestBodyObject,
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

export function collectOperations(
  spec: OpenAPIDocument,
  options: Pick<FromOpenAPIOptions, "tags" | "exclude">
): CollectedOpenAPIOperation[] {
  const collected: CollectedOpenAPIOperation[] = [];

  for (const [path, pathItemOrRef] of Object.entries(spec.paths ?? {})) {
    const pathItem = resolveRef<OpenAPIPathItemObject>(spec, pathItemOrRef);
    if (!pathItem || isReferenceObject(pathItem)) {
      continue;
    }

    const pathParameters = resolveParameters(spec, pathItem.parameters);

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }

      const resolvedOperation = resolveRef<OpenAPIOperationObject>(
        spec,
        operation
      );
      const operationParameters = resolveParameters(
        spec,
        resolvedOperation.parameters
      );
      const requestBody = resolvedOperation.requestBody
        ? resolveRef<OpenAPIRequestBodyObject>(spec, resolvedOperation.requestBody)
        : undefined;

      const item: CollectedOpenAPIOperation = {
        method,
        path,
        operation: resolvedOperation,
        parameters: mergeParameters(pathParameters, operationParameters),
        requestBody,
      };

      if (isIncluded(item, options)) {
        collected.push(item);
      }
    }
  }

  return collected;
}

function resolveParameters(
  spec: OpenAPIDocument,
  parameters?: Array<OpenAPIParameterObject | { $ref: string }>
): OpenAPIParameterObject[] {
  return (parameters ?? []).map((parameter) =>
    resolveRef<OpenAPIParameterObject>(spec, parameter)
  );
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
    if (!options.tags.some((tag) => tags.has(tag))) {
      return false;
    }
  }

  return !(options.exclude ?? []).some((rule) => matchesExcludeRule(operation, rule));
}

function matchesExcludeRule(
  operation: CollectedOpenAPIOperation,
  rule: OpenAPIExcludeRule
): boolean {
  if (rule.method && rule.method.toLowerCase() !== operation.method) {
    return false;
  }

  if (rule.operationId && !matchesPattern(rule.operationId, operation.operation.operationId ?? "")) {
    return false;
  }

  if (rule.path && !matchesPattern(rule.path, operation.path)) {
    return false;
  }

  if (rule.tags?.length) {
    const tags = new Set(operation.operation.tags ?? []);
    if (!rule.tags.some((tag) => tags.has(tag))) {
      return false;
    }
  }

  return true;
}

function matchesPattern(pattern: string | RegExp, value: string): boolean {
  return typeof pattern === "string" ? pattern === value : pattern.test(value);
}
