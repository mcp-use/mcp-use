import { writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { evalSuiteSchema } from "../src/schema/suite.v1.js";

const outPath = path.resolve("src/schema/eval-suite.v1.schema.json");

const jsonSchema = z.toJSONSchema(evalSuiteSchema, {
  target: "draft-7",
  reused: "inline",
});

writeFileSync(outPath, `${JSON.stringify(jsonSchema, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
