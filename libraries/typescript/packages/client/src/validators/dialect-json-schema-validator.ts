import type {
  JsonSchemaType,
  jsonSchemaValidator,
} from "@modelcontextprotocol/client";
import {
  CfWorkerJsonSchemaValidator,
  type CfWorkerSchemaDraft,
} from "@modelcontextprotocol/client/validators/cf-worker";

const DRAFT_04_URI = "http://json-schema.org/draft-04/schema";
const DRAFT_07_URI = "http://json-schema.org/draft-07/schema";
const DRAFT_2019_09_URIS = new Set([
  "https://json-schema.org/draft/2019-09/schema",
  "http://json-schema.org/draft/2019-09/schema",
]);
const DRAFT_2020_12_URIS = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "http://json-schema.org/draft/2020-12/schema",
]);

function resolveDraft(schema: JsonSchemaType): CfWorkerSchemaDraft | undefined {
  if (!("$schema" in schema) || typeof schema.$schema !== "string") {
    return "2020-12";
  }

  const normalized = schema.$schema.replace(/#$/, "");

  if (normalized === DRAFT_04_URI) return "4";
  if (normalized === DRAFT_07_URI) return "7";
  if (DRAFT_2019_09_URIS.has(normalized)) return "2019-09";
  if (DRAFT_2020_12_URIS.has(normalized)) return "2020-12";

  return undefined;
}

/**
 * JSON Schema validator that maps common `$schema` dialect URIs to the
 * matching `@cfworker/json-schema` draft. The v2 SDK default rejects any
 * schema not declaring JSON Schema 2020-12 as an "unsupported dialect", which
 * breaks `tools/call` against v1-era servers that emit draft-04/-07/2019-09
 * `$schema` on tool `outputSchema` (mcp-use#1839). Unknown `$schema` URIs
 * still fail fast via the SDK's strict default validator.
 */
export class DialectJsonSchemaValidator implements jsonSchemaValidator {
  getValidator<T>(schema: JsonSchemaType) {
    const draft = resolveDraft(schema);
    const delegate =
      draft !== undefined
        ? new CfWorkerJsonSchemaValidator({ draft })
        : new CfWorkerJsonSchemaValidator();
    return delegate.getValidator<T>(schema);
  }
}
