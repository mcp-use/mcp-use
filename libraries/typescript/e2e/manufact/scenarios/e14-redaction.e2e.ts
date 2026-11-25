// E14 S (quick): secret redaction controls (PLAN.md §18.8.4).
import { describe, expect, it } from "vitest";
import { RawClient } from "../src/raw-client.js";
import { waitUntil } from "../src/wait-until.js";
import { hasFixture, useTarget } from "./fixture.js";

describe.skipIf(!hasFixture)("E14 secret redaction (quick)", () => {
  const target = useTarget();

  it("the ctl_ control marker is found in the runtime logs, so the scan can see app output", async () => {
    const t = target();
    const marker = `ctl_e2e_${t.runTag}`;
    const client = new RawClient({
      url: t.mcpUrl,
      clientName: "ev-e2e-sep",
      protocolVersion: "2025-06-18",
    });
    await client.initialize();
    const res = await client.request("tools/call", {
      name: "log-marker",
      arguments: { marker, errorMarker: `err_e2e_${t.runTag}` },
    });
    expect(res.body.result?.isError).toBe(true);
    await waitUntil(
      "marker in logs",
      async () =>
        (await t.logs()).some((l) => l.includes(marker)) ? true : undefined,
      {
        deadlineMs: 15_000,
      }
    );
  });

  // TODO(events): subscribe with the run's whsec_ value and assert zero hits in
  // runtime/build logs and analytics once events/subscribe exists.
});
