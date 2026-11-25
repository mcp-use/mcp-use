// Rows of the E0-E21 catalog that are not runnable yet, reported as skipped
// with their reason so the run summary lists them (PLAN.md §18.8.5).
import { describe, it } from "vitest";
import { SCENARIOS } from "./catalog.js";
import { targetKind } from "../src/target.js";

const kind = targetKind();
describe("pending scenarios", () => {
  for (const row of SCENARIOS) {
    if (row.implemented) continue;
    const reason =
      kind === "local" && !row.local
        ? "not run locally"
        : (row.pending ?? "pending");
    const cls =
      kind === "manufact" && row.tags.includes("P")
        ? "platform-pending"
        : "pending";
    it.skip(`${row.id} ${row.title} [${cls}] ${reason}`, () => {});
  }
});
