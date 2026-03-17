/**
 * OpenAPI-to-MCP server bridge (TypeScript).
 *
 * Parses an OpenAPI 3.x / Swagger 2.x spec and creates an MCPServer instance
 * with each HTTP operation exposed as an MCP tool.
 */

// No zod dependency — we use the `inputs` array format for tool registration
// to avoid module resolution issues with pnpm strict mode.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url?: string }>;
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, any>>;
  components?: { schemas?: Record<string, any> };
  definitions?: Record<string, any>;
  [key: string]: any;
}

interface CompiledTool {
  name: string;
  description: string;
  method: string;
  path: string;
  baseUrl: string;
  parameters: ToolParameter[];
  bodySchema: any | null;
  jsonContentType: string | null;
}

interface ToolParameter {
  argName: string;
  wireName: string;
  location: "path" | "query" | "body" | "body_property";
  required: boolean;
  schema: any;
  description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

function toSnakeCase(value: string): string {
  let result = value.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  result = result.replace(/[^a-zA-Z0-9]+/g, "_");
  result = result.replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
  return result || "tool";
}

function sanitizeArgName(value: string): string {
  let result = toSnakeCase(value);
  if (!result || /^\d/.test(result)) {
    result = `arg_${result}`;
  }
  // Reserved words
  const reserved = new Set([
    "break", "case", "catch", "continue", "debugger", "default", "delete",
    "do", "else", "finally", "for", "function", "if", "in", "instanceof",
    "new", "return", "switch", "this", "throw", "try", "typeof", "var",
    "void", "while", "with", "class", "const", "enum", "export", "extends",
    "import", "super", "implements", "interface", "let", "package", "private",
    "protected", "public", "static", "yield",
  ]);
  if (reserved.has(result)) {
    result = `${result}_value`;
  }
  return result;
}

function allocateArgName(
  originalName: string,
  seen: Set<string>,
  prefix?: string
): string {
  let argName = sanitizeArgName(originalName);
  if (prefix) {
    argName = `${prefix}_${argName}`;
  }
  while (seen.has(argName)) {
    argName = `body_${argName}`;
  }
  seen.add(argName);
  return argName;
}

/** Resolve a local $ref pointer. */
function resolveRef(spec: any, ref: string): any {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local $ref pointers are supported, got: ${ref}`);
  }
  let current: any = spec;
  for (const part of ref.substring(2).split("/")) {
    current = current?.[part];
  }
  return current;
}

/** Recursively resolve all $ref in a schema. */
function resolveSchema(spec: any, value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => resolveSchema(spec, item));
  }
  if (value && typeof value === "object") {
    if ("$ref" in value) {
      const resolved = resolveRef(spec, value["$ref"]);
      const merged = { ...resolved };
      for (const [k, v] of Object.entries(value)) {
        if (k !== "$ref") merged[k] = v;
      }
      return resolveSchema(spec, merged);
    }
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = resolveSchema(spec, item);
    }
    return result;
  }
  return value;
}

/** Derive the base URL from the spec. */
function deriveBaseUrl(spec: OpenAPISpec): string {
  // OpenAPI 3.x
  if (spec.servers?.[0]?.url) {
    const url = spec.servers[0].url;
    // If it's a relative URL, we can't use it directly
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url.replace(/\/$/, "");
    }
  }
  // Swagger 2.x
  if (spec.host) {
    const scheme = spec.schemes?.[0] || "https";
    const basePath = spec.basePath || "";
    return `${scheme}://${spec.host}${basePath}`.replace(/\/$/, "");
  }
  return "";
}

type InputType = "string" | "number" | "boolean" | "object" | "array";

/** Map a JSON Schema type to a simple type name for the `inputs` array format. */
function jsonSchemaTypeToInputType(schema: any): InputType {
  if (!schema || typeof schema !== "object") return "string";
  const type = schema.type;
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  return "string";
}

// ---------------------------------------------------------------------------
// Main: compile OpenAPI operations into tool definitions
// ---------------------------------------------------------------------------

function mergeParameters(
  pathItem: Record<string, any>,
  operation: Record<string, any>
): any[] {
  const merged = new Map<string, any>();
  for (const container of [
    pathItem.parameters || [],
    operation.parameters || [],
  ]) {
    for (const param of container) {
      merged.set(`${param.name}::${param.in}`, param);
    }
  }
  return Array.from(merged.values());
}

function pickJsonRequestBody(
  operation: any
): { contentType: string; schema: any } | null {
  const requestBody = operation.requestBody;
  if (!requestBody) return null;

  const content = requestBody.content || {};
  for (const [contentType, bodyDef] of Object.entries<any>(content)) {
    if (
      contentType === "application/json" ||
      contentType.endsWith("+json")
    ) {
      return { contentType, schema: bodyDef?.schema || {} };
    }
  }
  return null;
}

export function compileOpenApiSpec(spec: OpenAPISpec): {
  tools: CompiledTool[];
  serverName: string;
  serverVersion: string;
} {
  const resolved = resolveSchema(spec, spec) as OpenAPISpec;
  const baseUrl = deriveBaseUrl(resolved);
  const serverName =
    resolved.info?.title || "openapi-server";
  const serverVersion = resolved.info?.version || "1.0.0";

  const tools: CompiledTool[] = [];

  for (const [path, pathItem] of Object.entries(resolved.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!operation || typeof operation !== "object") continue;

      const operationId = operation.operationId;
      const toolName = toSnakeCase(
        operationId || `${method}_${path.replace(/[{}\/]/g, "_")}`
      );
      const description =
        operation.summary ||
        operation.description ||
        `${method.toUpperCase()} ${path}`;

      const parameters: ToolParameter[] = [];
      const seen = new Set<string>();

      // Path / query parameters
      for (const param of mergeParameters(pathItem, operation)) {
        const location = param.in as string;
        if (location !== "path" && location !== "query") continue;

        const originalName = param.name;
        const argName = allocateArgName(
          originalName,
          seen,
          sanitizeArgName(originalName) in seen ? location : undefined
        );

        parameters.push({
          argName,
          wireName: originalName,
          location: location as "path" | "query",
          required: param.required || location === "path",
          schema: param.schema || { type: "string" },
          description: param.description,
        });
      }

      // Request body
      let bodySchema: any = null;
      let jsonContentType: string | null = null;

      const bodyInfo = pickJsonRequestBody(operation);
      if (operation.requestBody && !bodyInfo) {
        // Has request body but not JSON — skip this operation
        continue;
      }

      if (bodyInfo) {
        jsonContentType = bodyInfo.contentType;
        const schema = bodyInfo.schema;
        const bodyRequired = operation.requestBody?.required ?? false;

        if (
          schema.type === "object" &&
          schema.properties &&
          Object.keys(schema.properties).length > 0
        ) {
          bodySchema = schema;
          const bodyRequiredNames = new Set(schema.required || []);

          for (const [propName, propSchema] of Object.entries<any>(
            schema.properties
          )) {
            const argName = allocateArgName(
              propName,
              seen,
              sanitizeArgName(propName) in seen ? "body" : undefined
            );
            parameters.push({
              argName,
              wireName: propName,
              location: "body_property",
              required: bodyRequired && bodyRequiredNames.has(propName),
              schema: propSchema,
              description: (propSchema as any)?.description,
            });
          }
        } else {
          parameters.push({
            argName: "body",
            wireName: "body",
            location: "body",
            required: bodyRequired,
            schema,
            description: schema.description,
          });
        }
      }

      tools.push({
        name: toolName,
        description,
        method,
        path,
        baseUrl,
        parameters,
        bodySchema,
        jsonContentType,
      });
    }
  }

  return { tools, serverName, serverVersion };
}

/** Build an `inputs` array for a compiled tool (no Zod needed). */
export function buildInputs(tool: CompiledTool): Array<{
  name: string;
  type: InputType;
  required: boolean;
  description?: string;
}> {
  return tool.parameters.map((param) => ({
    name: param.argName,
    type: jsonSchemaTypeToInputType(param.schema),
    required: param.required,
    description:
      param.description || param.schema?.description || undefined,
  }));
}

/**
 * Create and start an MCPServer from an OpenAPI spec.
 *
 * Returns the server instance and the URL it's listening on.
 */
export async function startOpenApiMcpServer(
  spec: OpenAPISpec,
  port: number
): Promise<{ mcpUrl: string; serverName: string }> {
  const { MCPServer, text } = await import("mcp-use/server");

  const { tools, serverName, serverVersion } = compileOpenApiSpec(spec);

  const server = new MCPServer({
    name: serverName,
    version: serverVersion,
    description: `MCP server generated from OpenAPI spec: ${serverName}`,
  });

  for (const compiledTool of tools) {
    const inputs = buildInputs(compiledTool);

    // Capture compiledTool in closure
    const toolRef = compiledTool;

    server.tool(
      {
        name: toolRef.name,
        description: toolRef.description,
        inputs,
      },
      async (params: Record<string, any>) => {
        // Build the HTTP request
        let renderedPath = toolRef.path;
        const queryParams: Record<string, string> = {};
        const bodyFields: Record<string, any> = {};
        let jsonBody: any = null;

        for (const param of toolRef.parameters) {
          const value = params[param.argName];
          if (value === undefined || value === null) continue;

          switch (param.location) {
            case "path":
              renderedPath = renderedPath.replace(
                `{${param.wireName}}`,
                encodeURIComponent(String(value))
              );
              break;
            case "query":
              queryParams[param.wireName] = String(value);
              break;
            case "body":
              jsonBody = value;
              break;
            case "body_property":
              bodyFields[param.wireName] = value;
              break;
          }
        }

        if (Object.keys(bodyFields).length > 0) {
          jsonBody = bodyFields;
        }

        // Build URL
        const url = new URL(
          renderedPath,
          toolRef.baseUrl.endsWith("/")
            ? toolRef.baseUrl
            : `${toolRef.baseUrl}/`
        );
        for (const [key, value] of Object.entries(queryParams)) {
          url.searchParams.set(key, value);
        }

        // Make the request
        const fetchOptions: RequestInit = {
          method: toolRef.method.toUpperCase(),
          headers: {} as Record<string, string>,
        };

        if (jsonBody !== null && toolRef.jsonContentType) {
          (fetchOptions.headers as Record<string, string>)["Content-Type"] =
            toolRef.jsonContentType;
          fetchOptions.body = JSON.stringify(jsonBody);
        }

        try {
          const response = await fetch(url.toString(), fetchOptions);
          const contentType = response.headers
            .get("content-type")
            ?.split(";")[0] || "";

          let data: any;
          if (
            contentType === "application/json" ||
            contentType.endsWith("+json")
          ) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          const result = {
            status: response.status,
            contentType,
            data,
          };

          return text(JSON.stringify(result, null, 2));
        } catch (err: any) {
          return text(
            JSON.stringify(
              {
                error: err.message || "Request failed",
                url: url.toString(),
                method: toolRef.method.toUpperCase(),
              },
              null,
              2
            )
          );
        }
      }
    );
  }

  // Start the server
  await server.listen(port);

  const mcpUrl = `http://localhost:${port}/mcp`;
  return { mcpUrl, serverName };
}
