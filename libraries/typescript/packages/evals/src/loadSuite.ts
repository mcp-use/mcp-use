import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { evalSuiteSchema, type EvalSuite } from "./schema/suite.v1.js";

export async function loadSuiteFromFile(path: string): Promise<EvalSuite> {
  const raw = await readFile(path, "utf8");
  return loadSuiteFromString(raw);
}

export function loadSuiteFromString(raw: string): EvalSuite {
  const doc = parseYaml(raw);
  return evalSuiteSchema.parse(substituteEnv(doc));
}

function substituteEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => {
      return process.env[key] ?? "";
    });
  }
  if (Array.isArray(value)) {
    return value.map(substituteEnv);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteEnv(v);
    }
    return out;
  }
  return value;
}
