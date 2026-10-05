const EVENTS = new Set([
  "constructed",
  "restore",
  "remove",
  "clear",
  "write",
  "ack",
  "host-notification",
  "reconcile",
  "blocked",
  "accepted-empty-readback",
  "accepted-equal-readback",
]);

/** Pick only bounded protocol structure for development terminal diagnostics. @internal */
export function sanitizeContextDiagnostic(
  value: unknown
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.event !== "string" || !EVENTS.has(data.event))
    return undefined;
  const result: Record<string, unknown> = { event: data.event };
  for (const key of [
    "seq",
    "ms",
    "queued",
    "selected",
    "sending",
    "desired",
    "revision",
  ]) {
    if (
      data[key] === null ||
      (Number.isSafeInteger(data[key]) && (data[key] as number) >= 0)
    )
      result[key] = data[key];
  }
  for (const key of [
    "duringWrite",
    "knownUpdate",
    "contentProvided",
    "metaPresent",
    "updateIdNonempty",
  ]) {
    if (typeof data[key] === "boolean") result[key] = data[key];
  }
  for (const key of ["extensionType", "updateIdType"]) {
    if (
      ["undefined", "null", "object", "string", "number", "boolean"].includes(
        data[key] as string
      )
    )
      result[key] = data[key];
  }
  for (const key of ["payload", "acknowledged", "preceding"]) {
    const payload = data[key];
    if (payload === null) {
      result[key] = null;
      continue;
    }
    if (!payload || typeof payload !== "object") continue;
    const shape = payload as Record<string, unknown>;
    if (!Array.isArray(shape.content) || shape.content.length > 64) continue;
    result[key] = {
      content: shape.content.map((item: unknown) => {
        const block =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        return {
          type: ["text", "image", "resource", "resource_link"].includes(
            block.type as string
          )
            ? block.type
            : "unknown",
          fingerprint:
            typeof block.fingerprint === "string" &&
            /^[a-f0-9]{1,8}$/.test(block.fingerprint)
              ? block.fingerprint
              : null,
        };
      }),
      structured:
        typeof shape.structured === "string" &&
        /^[a-f0-9]{1,8}$/.test(shape.structured)
          ? shape.structured
          : null,
    };
  }
  return result;
}
