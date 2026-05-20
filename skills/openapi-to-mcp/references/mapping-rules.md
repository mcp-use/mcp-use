# OpenAPI → MCP tool mapping rules

This file is the contract for how an OpenAPI document becomes a set of MCP tools. Follow it mechanically. The point is determinism: two runs of the skill against the same spec should produce the same tool list, the same names, and the same schemas.

## Table of contents

1. Tool naming
2. Tool description
3. Parameter merging (path, query, header, body)
4. Zod schema conversion
5. Response handling
6. Filtering large specs
7. Multi-content request bodies
8. Edge cases: recursion, polymorphism, files, streams

---

## 1. Tool naming

Order of preference:

1. **`operationId` if present.** Normalize to snake_case. `getPetById` → `get_pet_by_id`. `listUsers` → `list_users`. Drop characters that aren't `[a-z0-9_]`.
2. **`${method}_${path}` fallback.** Lowercase the method; replace `/`, `{`, `}` with `_`, collapse repeated `_`, trim. `GET /pets/{petId}/owners` → `get_pets_pet_id_owners`.
3. **Collision resolution.** If two operations map to the same name (rare but possible with the fallback), append the method as a suffix to the second: `get_users`, `get_users_post`. Always log the rename so the user notices.

Tool names are user-visible in the LLM's tool catalog. Keep them under 60 characters and avoid double underscores.

## 2. Tool description

Build the description from the operation in this order:

```
{summary}

{description}

[Tags: {tags joined}]
```

Skip any section that's empty. Trim trailing whitespace. If both `summary` and `description` are missing — which is common in hand-written specs — fall back to `${method.toUpperCase()} ${path}` so the LLM at least sees the route. Log a warning so the user can improve the spec.

Don't paraphrase the description. The LLM reads what you write here; if the spec says "Returns up to 100 pets in the store, paginated", say exactly that.

## 3. Parameter merging

OpenAPI splits parameters across several locations. The MCP tool schema is a single flat zod object. Merge as follows:

- **`parameters[].in == "path"`** → top-level field, always required (path params are non-optional in OpenAPI).
- **`parameters[].in == "query"`** → top-level field; required if `required: true`, else `.optional()`.
- **`parameters[].in == "header"`** → top-level field, prefixed with `header_` to avoid collisions (`X-Request-Id` → `header_x_request_id`). Most APIs don't need the LLM to set headers — usually only auth-related, and those come from env vars. Only expose a header param to the LLM if it's a real input (e.g., `X-Idempotency-Key`).
- **`requestBody.content.application/json.schema`** → if the body schema is an object, splat its properties into the top level (so the LLM sees one flat arg list, not `{ body: { ... } }`). If the body is a primitive or array, expose it as a single `body` field.
- **`parameters[].in == "cookie"`** → ignore. Cookie-based APIs from an MCP server are almost always a misconfiguration; surface a warning.

Collision handling: if a query param and a body field share a name, prefix the query one with `query_`. Log the rename.

## 4. Zod schema conversion

Walk the OpenAPI schema recursively. The mapping table:

| OpenAPI | Zod |
|---|---|
| `type: string` | `z.string()` |
| `type: string`, `enum: [...]` | `z.enum([...])` |
| `type: string`, `format: date-time` | `z.string().datetime()` |
| `type: string`, `format: email` | `z.string().email()` |
| `type: string`, `format: uri` | `z.string().url()` |
| `type: string`, `format: uuid` | `z.string().uuid()` |
| `type: integer` | `z.number().int()` |
| `type: number` | `z.number()` |
| `type: boolean` | `z.boolean()` |
| `type: array`, `items: T` | `z.array(T)` |
| `type: object` with `properties` | `z.object({...})` (apply `.optional()` to non-required) |
| `type: object` with `additionalProperties: T` | `z.record(T)` |
| `oneOf: [A, B]` | `z.union([A, B])` |
| `anyOf: [A, B]` | `z.union([A, B])` |
| `allOf: [A, B]` (objects) | merge into one `z.object` |
| `nullable: true` (3.0) | `.nullable()` |
| `type: [..., "null"]` (3.1) | `.nullable()` |
| missing `type` | `z.unknown()` |

Carry over constraints:

- `minimum` / `maximum` → `.min()` / `.max()` (numbers) or `.gte()` / `.lte()`.
- `minLength` / `maxLength` → `.min()` / `.max()` on strings.
- `minItems` / `maxItems` → `.min()` / `.max()` on arrays.
- `pattern` → `.regex(new RegExp(pattern))`.
- `default` → `.default(value)`.
- `description` or `title` → `.describe(...)`.

**Always describe.** Every field should chain a `.describe()`. If the OpenAPI field has no description, fall back to the field name in human-readable form. The LLM uses descriptions to pick values; missing descriptions degrade quality more than any other single thing.

## 5. Response handling

The LLM doesn't strictly need an output schema — it can read the JSON the tool returns and reason about it. But declaring one improves results:

- If `responses.200.content.application/json.schema` exists, convert it to zod (same rules as above) and pass as `outputSchema`.
- If the response is a list, the schema is the list shape — the LLM will paginate naturally if `description` mentions it.
- If the response is binary (`application/octet-stream`, `image/*`), return a text message: `"Downloaded N bytes of type X"` and either save to disk or omit. The MCP tool result should not embed binary blobs.
- If the response is `text/event-stream` (SSE) or `application/x-ndjson`, accumulate chunks and return as text. Real streaming through MCP is possible but out of scope for the first version.
- Non-2xx: throw with a structured error. The tool result becomes `text("Error: " + e.message)`. Include the HTTP status and the response body — the LLM uses both to decide whether to retry or ask the user.

## 6. Filtering large specs

When a spec has more than ~30 operations, ask the user to filter. Strategies:

- **By tag.** Most large specs (Stripe, GitHub, Twilio) tag operations. Expose tags as the filter unit: "Include only the `pets` tag" maps to `operations.filter(op => op.tags?.includes("pets"))`.
- **By prefix.** `GET /v1/charges/*` → all charges operations. Useful when tags are missing.
- **By explicit list.** The user names ops: `["createCustomer", "listInvoices", "retrieveCharge"]`. Use this for cherry-picked exposures.
- **Method-only.** Some users only want read access — filter to `GET` operations.

Whatever filter you apply, write it into `index.ts` as a visible constant (`OPERATION_ALLOWLIST` or `INCLUDED_TAGS`) so the user can edit it later without re-running the generator.

## 7. Multi-content request bodies

If `requestBody.content` has multiple media types:

- Prefer `application/json` if present.
- Fall back to `application/x-www-form-urlencoded` (encode args as form data in `client.ts`).
- Fall back to `multipart/form-data` only if the user explicitly asks (file uploads — most LLM clients aren't great at file args anyway).
- Skip any operation whose only body type is `application/octet-stream` (binary upload) unless the user wants that operation specifically; expose it as a tool that takes a `filePath` and the handler reads the file.

## 8. Edge cases

**Recursive `$ref` after dereferencing.** swagger-parser keeps cycles as live refs. When you hit one, fall back to `z.lazy(() => ...)` with `z.unknown()` as the leaf — the LLM will read JSON anyway.

**Polymorphism with discriminators.** OpenAPI's `discriminator` is a hint the LLM doesn't need; convert `oneOf` to a plain `z.union` and let the LLM see the discriminator field in the description.

**File downloads.** GET that returns `application/pdf` etc.: the tool takes a `savePath` param, writes the body to that path, and returns `"Saved <bytes> bytes to <path>"`.

**Webhooks / callbacks.** Skip `webhooks` and `callbacks` sections entirely — they're server-initiated, not LLM-initiated. If the user asks "can the LLM receive webhooks?", that's a different architecture (event-driven MCP) and out of scope.

**Deprecated operations.** If `deprecated: true`, either skip or include with `[DEPRECATED]` prefix in the description. Default: skip. Tell the user.

**Vendor extensions (`x-*`).** Ignore unless you recognize one. `x-internal: true` is a common signal to skip; respect it.
