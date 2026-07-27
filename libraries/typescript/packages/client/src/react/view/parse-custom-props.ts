/**
 * Parses JSON object and array values from string-valued custom properties.
 *
 * Invalid JSON and scalar-looking strings are preserved unchanged.
 *
 * @param customProps - Properties supplied by a host integration.
 * @returns A new record containing parsed object and array values.
 */
export function parseCustomProps(
  customProps?: Record<string, string>
): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  if (!customProps) return parsed;
  for (const [k, v] of Object.entries(customProps)) {
    if (
      typeof v === "string" &&
      (v.trim().startsWith("[") || v.trim().startsWith("{"))
    ) {
      try {
        parsed[k] = JSON.parse(v);
      } catch {
        parsed[k] = v;
      }
    } else {
      parsed[k] = v;
    }
  }
  return parsed;
}
