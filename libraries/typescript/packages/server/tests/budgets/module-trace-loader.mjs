import { writeSync } from "node:fs";

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  writeSync(
    2,
    `MCP_USE_RESOLVE ${JSON.stringify({
      url: result.url,
      parentURL: context.parentURL ?? null,
    })}\n`
  );
  return result;
}
