export type ArgMatcher =
  | "any"
  | { any: true; requirePresent: true }
  | string
  | number
  | boolean
  | { contains: string }
  | { pattern: string }
  | Record<string, unknown>;

export function isArgMatcherRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRequiredPresentAnyMatcher(matcher: unknown): boolean {
  return (
    typeof matcher === "object" &&
    matcher !== null &&
    !Array.isArray(matcher) &&
    (matcher as { any?: unknown }).any === true &&
    (matcher as { requirePresent?: unknown }).requirePresent === true
  );
}

function argTextForMatching(actualVal: unknown): string {
  if (actualVal === null || actualVal === undefined) return "";
  if (typeof actualVal === "string") return actualVal;
  if (typeof actualVal === "number" || typeof actualVal === "boolean") return String(actualVal);
  try {
    return JSON.stringify(actualVal);
  } catch {
    return String(actualVal);
  }
}

export function matchArgs(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): boolean {
  for (const [key, matcher] of Object.entries(expected)) {
    const actualVal = actual[key];
    if (matcher === "any") continue;
    if (isRequiredPresentAnyMatcher(matcher)) {
      if (actualVal === undefined) return false;
      continue;
    }
    if (typeof matcher === "string") {
      if (argTextForMatching(actualVal).toLowerCase() !== matcher.toLowerCase()) return false;
      continue;
    }
    if (typeof matcher === "number" || typeof matcher === "boolean") {
      if (actualVal !== matcher && String(actualVal) !== String(matcher)) return false;
      continue;
    }
    if (isArgMatcherRecord(matcher)) {
      const actualStr = argTextForMatching(actualVal);
      if (typeof matcher.contains === "string") {
        if (!actualStr.toLowerCase().includes(matcher.contains.toLowerCase())) return false;
        continue;
      }
      if (typeof matcher.pattern === "string") {
        try {
          if (!new RegExp(matcher.pattern, "i").test(actualStr)) return false;
        } catch {
          return false;
        }
        continue;
      }
      try {
        if (JSON.stringify(actualVal) !== JSON.stringify(matcher)) return false;
      } catch {
        return false;
      }
      continue;
    }
    if (argTextForMatching(actualVal) !== String(matcher ?? "")) return false;
  }
  return true;
}

export function matchWidgetFields(
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | undefined
): { passed: boolean; reason: string } {
  if (!actual) {
    return { passed: false, reason: "no structuredContent/widget fields in tool result" };
  }
  for (const [key, expectedVal] of Object.entries(expected)) {
    const actualVal = actual[key];
    if (JSON.stringify(actualVal) !== JSON.stringify(expectedVal)) {
      return {
        passed: false,
        reason: `widget field "${key}": expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`,
      };
    }
  }
  return { passed: true, reason: "widget fields match" };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
