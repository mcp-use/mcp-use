import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENTS_ENV_VARIABLES, EVENTS_KNOBS } from "../../src/events/env.js";
import { LAYOUT_1, LAYOUT_VERSION } from "../../src/events/internal/layout.js";
import { EVENTS_ROUTES } from "../../src/events/routes/contract.js";

// TODO(events): add the normalized `tsc --emitDeclarationOnly` snapshots of
// §17.4 under contracts/events/ and diff them here.

const dir = new URL("../../../../contracts/events/", import.meta.url);
const update = process.env["UPDATE_EVENTS_CONTRACTS"] === "1";

function check(file: string, value: unknown): void {
  const url = new URL(file, dir);
  const text = JSON.stringify(value, null, 2) + "\n";
  if (update) writeFileSync(url, text);
  expect(readFileSync(url, "utf8")).toBe(text);
}

describe("frozen Events contracts", () => {
  it("layout-1.json matches the key-family table", () => {
    check("layout-1.json", { layout: LAYOUT_VERSION, families: LAYOUT_1 });
  });

  it("env.json matches the environment reader", () => {
    check("env.json", { knobs: EVENTS_KNOBS, variables: EVENTS_ENV_VARIABLES });
  });

  it("routes.json matches the internal route table", () => {
    check("routes.json", { prefix: "/_mcp-use/events", routes: EVENTS_ROUTES });
  });
});
