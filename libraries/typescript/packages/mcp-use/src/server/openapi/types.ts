import type { MCPServer } from "../mcp-server.js";

export type OpenAPIHttpMethod =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch"
  | "trace";

export type OpenAPIReferenceObject = {
  $ref: string;
};

export type OpenAPISchemaObject = {
  type?: string | string[];
  properties?: Record<string, OpenAPISchemaObject | OpenAPIReferenceObject>;
  items?: OpenAPISchemaObject | OpenAPIReferenceObject;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  format?: string;
  description?: string;
  nullable?: boolean;
  oneOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  anyOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  allOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  additionalProperties?: boolean | OpenAPISchemaObject | OpenAPIReferenceObject;
  [key: string]: unknown;
};

export type OpenAPIParameterObject = {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  description?: string;
  required?: boolean;
  schema?: OpenAPISchemaObject | OpenAPIReferenceObject;
};

export type OpenAPIRequestBodyObject = {
  description?: string;
  required?: boolean;
  content?: Record<
    string,
    {
      schema?: OpenAPISchemaObject | OpenAPIReferenceObject;
    }
  >;
};

export type OpenAPIOperationObject = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<OpenAPIParameterObject | OpenAPIReferenceObject>;
  requestBody?: OpenAPIRequestBodyObject | OpenAPIReferenceObject;
  responses?: Record<string, unknown>;
};

export type OpenAPIPathItemObject = Partial<
  Record<OpenAPIHttpMethod, OpenAPIOperationObject>
> & {
  parameters?: Array<OpenAPIParameterObject | OpenAPIReferenceObject>;
};

export type OpenAPIDocument = {
  openapi: string;
  info: {
    title: string;
    version?: string;
  };
  servers?: Array<{ url: string }>;
  paths?: Record<string, OpenAPIPathItemObject | OpenAPIReferenceObject>;
  components?: Record<string, unknown>;
};

export type OpenAPIAuth =
  | { type: "bearer"; token: string | undefined }
  | { type: "header"; name: string; value: string | undefined };

export type OpenAPIExcludeRule = {
  operationId?: string | RegExp;
  path?: string | RegExp;
  method?: OpenAPIHttpMethod | Uppercase<OpenAPIHttpMethod>;
  tags?: string[];
};

export type FromOpenAPIOptions = {
  spec: OpenAPIDocument;
  baseUrl?: string;
  name?: string;
  version?: string;
  auth?: OpenAPIAuth;
  headers?: Record<string, string>;
  tags?: string[];
  exclude?: OpenAPIExcludeRule[];
  fetch?: typeof fetch;
};

export type OpenAPIServerLike = Pick<MCPServer, "tool">;

export type CollectedOpenAPIOperation = {
  method: OpenAPIHttpMethod;
  path: string;
  operation: OpenAPIOperationObject;
  parameters: OpenAPIParameterObject[];
  requestBody?: OpenAPIRequestBodyObject;
};
