type ToolMetadata = Record<string, unknown>;

/**
 * Tool-result metadata augments the tool definition metadata. It must not erase
 * the definition's MCP Apps resource URI when a server returns unrelated
 * result metadata such as analytics or tracing fields.
 */
export function mergeToolMetadata(
  definitionMetadata: ToolMetadata | undefined,
  resultMetadata: ToolMetadata | undefined
): ToolMetadata | undefined {
  if (!definitionMetadata) return resultMetadata;
  if (!resultMetadata) return definitionMetadata;

  const definitionUi =
    definitionMetadata.ui &&
    typeof definitionMetadata.ui === "object" &&
    !Array.isArray(definitionMetadata.ui)
      ? (definitionMetadata.ui as ToolMetadata)
      : undefined;
  const resultUi =
    resultMetadata.ui &&
    typeof resultMetadata.ui === "object" &&
    !Array.isArray(resultMetadata.ui)
      ? (resultMetadata.ui as ToolMetadata)
      : undefined;

  return {
    ...definitionMetadata,
    ...resultMetadata,
    ...(definitionUi || resultUi
      ? { ui: { ...definitionUi, ...resultUi } }
      : {}),
  };
}
