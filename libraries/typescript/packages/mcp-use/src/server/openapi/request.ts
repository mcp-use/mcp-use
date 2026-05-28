import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { error, object as objectResponse, text } from "../utils/response-helpers.js";
import type {
  CollectedOpenAPIOperation,
  FromOpenAPIOptions,
  OpenAPIParameterObject,
} from "./types.js";

export async function callOpenAPIOperation(
  operation: CollectedOpenAPIOperation,
  params: Record<string, unknown>,
  options: FromOpenAPIOptions
): Promise<CallToolResult> {
  const fetchImpl = options.fetch ?? fetch;
  const url = buildUrl(operation, params, options);
  const headers = buildHeaders(operation.parameters, params, options);
  const body = params.body === undefined ? undefined : JSON.stringify(params.body);

  if (body !== undefined && !hasHeader(headers, "content-type")) {
    headers["content-type"] = "application/json";
  }

  const response = await fetchImpl(url, {
    method: operation.method.toUpperCase(),
    headers,
    body,
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    return error(await response.text());
  }

  if (contentType.includes("application/json") || contentType.includes("+json")) {
    return objectResponse(await response.json());
  }

  return text(await response.text());
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
    if (parameter.in !== "query") {
      continue;
    }
    const value = params[parameter.name];
    if (value === undefined || value === null || value === "") {
      continue;
    }
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
    if (parameter.in !== "header") {
      continue;
    }
    const value = params[parameter.name];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    headers[parameter.name] = String(value);
  }

  if (options.auth?.type === "bearer" && options.auth.token) {
    headers.authorization = `Bearer ${options.auth.token}`;
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
  return Object.keys(headers).some((headerName) => headerName.toLowerCase() === name);
}
