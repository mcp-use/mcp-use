import { PlannerError } from "../shared/errors.js";
import { TestPlanSchema, type TestPlan } from "./planSchema.js";

/**
 * Sanitize JavaScript-like JSON to valid JSON.
 * Converts `undefined` values to `null`.
 *
 * @param jsonStr - String containing JavaScript-like JSON
 * @returns Valid JSON string
 * @internal
 */
function sanitizeJson(jsonStr: string): string {
  // Replace JavaScript-style undefined with null for valid JSON
  return jsonStr.replace(/:\s*undefined\b/g, ": null");
}

/**
 * Extract a balanced JSON object starting from a given index.
 * Properly handles nested braces and string escaping.
 *
 * @param content - String containing JSON
 * @param startIndex - Index of opening brace
 * @returns Extracted JSON string or null if not balanced
 * @internal
 */
function extractBalancedJson(
  content: string,
  startIndex: number
): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return content.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extract and parse JSON from planner LLM response.
 * Handles both fenced code blocks and raw JSON objects.
 *
 * @param content - Raw LLM response content
 * @returns Parsed JSON object
 * @throws {PlannerError} If JSON not found or invalid
 *
 * @example
 * ```typescript
 * const json = extractPlannerJson('```json\n{"tools": []}\n```');
 * ```
 */
export function extractPlannerJson(content: string): unknown {
  const fenced = content.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(sanitizeJson(fenced[1]));
    } catch (error) {
      throw new PlannerError("Planner response JSON is invalid", error);
    }
  }

  const firstBrace = content.indexOf("{");
  if (firstBrace !== -1) {
    const extracted = extractBalancedJson(content, firstBrace);
    if (extracted) {
      try {
        return JSON.parse(sanitizeJson(extracted));
      } catch (error) {
        throw new PlannerError("Planner response JSON is invalid", error);
      }
    }
  }

  throw new PlannerError("Planner response did not include JSON output");
}

/**
 * Validate a test plan against the schema.
 *
 * @param data - Raw parsed JSON data
 * @returns Validated TestPlan object
 * @throws {PlannerError} If validation fails
 *
 * @example
 * ```typescript
 * const plan = validatePlan(jsonData);
 * console.log(plan.tools[0].tests);
 * ```
 */
export function validatePlan(data: unknown): TestPlan {
  const parsed = TestPlanSchema.safeParse(data);
  if (!parsed.success) {
    throw new PlannerError(`Planner output failed validation: ${parsed.error}`);
  }
  return parsed.data;
}
