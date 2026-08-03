/**
 * Parse an in-progress JSON object emitted by an LLM tool call.
 *
 * Tool arguments frequently contain code, SVG, or JSON-as-a-string. Counting
 * braces with a regular expression breaks for those inputs because braces
 * inside a JSON string are data, not structure. This scanner only heals
 * delimiters outside strings and closes a trailing string when possible.
 */
export function parsePartialToolArgs(
  raw: string
): Record<string, unknown> | undefined {
  if (!raw) return undefined;

  const complete = parseObject(raw);
  if (complete) return complete;

  const stack: Array<"}" | "]"> = [];
  let inString = false;
  let escaping = false;

  for (const char of raw) {
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === "}" || char === "]") {
      if (stack[stack.length - 1] === char) stack.pop();
    }
  }

  let healed = raw;
  // A fragment may stop between the backslash and the escaped character. The
  // backslash remains in the real buffer; omit it only from this renderable
  // snapshot so JSON.parse can close the current string.
  if (inString && escaping) healed = healed.slice(0, -1);
  if (inString) healed += '"';
  healed += [...stack].reverse().join("");

  return parseObject(healed);
}

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null &&
      !Array.isArray(parsed) &&
      typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
