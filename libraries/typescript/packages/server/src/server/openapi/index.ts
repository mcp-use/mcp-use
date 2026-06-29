import { callOpenAPIOperation } from "./request.js";
import { createToolInputSchema } from "./schema.js";
import { createToolDescription, createToolNames } from "./naming.js";
import { collectOperations } from "./operations.js";
import type { FromOpenAPIOptions, OpenAPIServerLike } from "./types.js";

export type {
  FromOpenAPIOptions,
  OpenAPIAuth,
  OpenAPIDocument,
  OpenAPIExcludeRule,
} from "./types.js";

export function registerOpenAPITools(
  server: OpenAPIServerLike,
  options: FromOpenAPIOptions
): void {
  const operations = collectOperations(options.spec, options);
  const names = createToolNames(operations);

  for (const [index, operation] of operations.entries()) {
    server.tool(
      {
        name: names[index],
        description: createToolDescription(operation),
        schema: createToolInputSchema(options.spec, operation),
      },
      async (params) => callOpenAPIOperation(operation, params, options)
    );
  }
}
