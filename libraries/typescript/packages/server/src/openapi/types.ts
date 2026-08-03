/** HTTP methods that may define operations in an OpenAPI path item. */
export type OpenAPIHttpMethod =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch"
  | "trace";

/** A local or external OpenAPI reference. Only bundled local references are resolved. */
export interface OpenAPIReferenceObject {
  /** JSON Pointer or external URI identifying the referenced object. */
  $ref: string;
}

/**
 * The JSON-Schema-compatible subset used by OpenAPI parameters and request
 * bodies. Additional keywords are retained when generated tool schemas are
 * advertised and validated.
 */
export interface OpenAPISchemaObject {
  /** JSON Schema type, including OpenAPI 3.1 nullable type arrays. */
  type?: string | string[];
  /** Named object properties. */
  properties?: Record<string, OpenAPISchemaObject | OpenAPIReferenceObject>;
  /** Array item schema. */
  items?: OpenAPISchemaObject | OpenAPIReferenceObject;
  /** Required object property names. */
  required?: string[];
  /** Allowed literal values. */
  enum?: Array<string | number | boolean | null>;
  /** Optional format hint such as `date-time`. */
  format?: string;
  /** Human-readable schema description. */
  description?: string;
  /** OpenAPI 3.0 nullable marker. */
  nullable?: boolean;
  /** Exactly-one-of schema alternatives. */
  oneOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  /** Any-of schema alternatives. */
  anyOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  /** All-of schema composition. */
  allOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  /** Whether and how undeclared object properties are validated. */
  additionalProperties?: boolean | OpenAPISchemaObject | OpenAPIReferenceObject;
  /** Other OpenAPI or JSON Schema keywords preserved during conversion. */
  [key: string]: unknown;
}

/** An OpenAPI operation parameter. */
export interface OpenAPIParameterObject {
  /** Parameter name as it appears in the path, query string, or headers. */
  name: string;
  /** HTTP request location for the parameter. */
  in: "query" | "header" | "path" | "cookie";
  /** Human-readable parameter description exposed to MCP clients. */
  description?: string;
  /** Whether callers must provide the parameter. Path parameters are always required. */
  required?: boolean;
  /** Parameter value schema. */
  schema?: OpenAPISchemaObject | OpenAPIReferenceObject;
}

/** An OpenAPI request body definition. */
export interface OpenAPIRequestBodyObject {
  /** Human-readable request body description. */
  description?: string;
  /** Whether callers must provide the generated `body` input field. */
  required?: boolean;
  /** Request schemas keyed by media type. JSON-compatible entries are supported. */
  content?: Record<
    string,
    {
      /** Schema for this media type. */
      schema?: OpenAPISchemaObject | OpenAPIReferenceObject;
    }
  >;
}

/** An operation attached to an OpenAPI path and HTTP method. */
export interface OpenAPIOperationObject {
  /** Preferred MCP tool name before sanitization and collision handling. */
  operationId?: string;
  /** Short operation summary used in the generated tool description. */
  summary?: string;
  /** Longer operation details used in the generated tool description. */
  description?: string;
  /** Tags used by {@link FromOpenAPIOptions.tags} and exclusion rules. */
  tags?: string[];
  /** Operation-level parameters, which override same-name path parameters. */
  parameters?: Array<OpenAPIParameterObject | OpenAPIReferenceObject>;
  /** Optional request body or local reference. */
  requestBody?: OpenAPIRequestBodyObject | OpenAPIReferenceObject;
  /** Response definitions. Generated tools return the upstream response dynamically. */
  responses?: Record<string, unknown>;
}

/** A path item containing shared parameters and method operations. */
export type OpenAPIPathItemObject = Partial<
  Record<OpenAPIHttpMethod, OpenAPIOperationObject | OpenAPIReferenceObject>
> & {
  /** Parameters shared by every operation under this path. */
  parameters?: Array<OpenAPIParameterObject | OpenAPIReferenceObject>;
};

/**
 * Parsed, bundled OpenAPI 3.x document accepted by
 * {@link MCPServer.fromOpenAPI}.
 *
 * External references are not fetched. Bundle them into local `#/...`
 * references before constructing the server.
 */
export interface OpenAPIDocument {
  /** OpenAPI document version, for example `"3.1.0"`. */
  openapi: string;
  /** API identity used as the generated MCP server defaults. */
  info: {
    /** Human-readable API title, used as the default server name. */
    title: string;
    /** API version, used as the default server version when present. */
    version?: string;
  };
  /** Candidate upstream base URLs; the first is used by default. */
  servers?: Array<{
    /** Absolute upstream base URL. */
    url: string;
  }>;
  /** API operations keyed by URL path template. */
  paths?: Record<string, OpenAPIPathItemObject | OpenAPIReferenceObject>;
  /** Reusable schemas, parameters, and request bodies addressed by local references. */
  components?: Record<string, unknown>;
}

/** Static authentication added to every generated upstream request. */
export type OpenAPIAuth =
  | {
      /** Send the credential in the `Authorization` header as a bearer token. */
      type: "bearer";
      /** Bearer credential. `undefined` omits the header, which supports optional env vars. */
      token: string | undefined;
    }
  | {
      /** Send the credential in a caller-selected header. */
      type: "header";
      /** Header name, such as `x-api-key`. */
      name: string;
      /** Header value. `undefined` omits the header, which supports optional env vars. */
      value: string | undefined;
    };

/** Criteria for excluding generated operations. Fields within one rule are ANDed. */
export interface OpenAPIExcludeRule {
  /** Exact operation ID or regular expression to match. */
  operationId?: string | RegExp;
  /** Exact OpenAPI path template or regular expression to match. */
  path?: string | RegExp;
  /** HTTP method to match, case-insensitively. */
  method?: OpenAPIHttpMethod | Uppercase<OpenAPIHttpMethod>;
  /** Match when the operation has any of these tags. */
  tags?: string[];
}

/** Options for {@link MCPServer.fromOpenAPI}. */
export interface FromOpenAPIOptions {
  /** Parsed, bundled OpenAPI document. */
  spec: OpenAPIDocument;
  /** Upstream base URL, overriding the first `spec.servers` entry. */
  baseUrl?: string;
  /** MCP server name, overriding `spec.info.title`. */
  name?: string;
  /** MCP server version, overriding `spec.info.version` and the `"1.0.0"` fallback. */
  version?: string;
  /** Static bearer or custom-header authentication for upstream requests. */
  auth?: OpenAPIAuth;
  /** Static headers merged into every upstream request. */
  headers?: Record<string, string>;
  /** Include only operations having at least one of these tags. */
  tags?: string[];
  /** Rules for excluding operations after tag filtering. */
  exclude?: OpenAPIExcludeRule[];
  /** Fetch implementation used for upstream calls. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/** A resolved operation ready to become an MCP tool. @internal */
export interface CollectedOpenAPIOperation {
  /** Lowercase HTTP method. */
  method: OpenAPIHttpMethod;
  /** OpenAPI path template. */
  path: string;
  /** Resolved operation definition. */
  operation: OpenAPIOperationObject;
  /** Resolved and merged path plus operation parameters. */
  parameters: OpenAPIParameterObject[];
  /** Resolved JSON request body definition, when present. */
  requestBody?: OpenAPIRequestBodyObject;
}
