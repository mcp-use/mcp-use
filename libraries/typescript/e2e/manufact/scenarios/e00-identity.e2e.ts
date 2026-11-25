// E0 S: deploy and identity (PLAN.md §18.8.4).
import { describe, expect, it } from "vitest";
import { RawClient } from "../src/raw-client.js";
import { hasFixture, toolText, useTarget } from "./fixture.js";

describe.skipIf(!hasFixture)("E0 deploy and identity", () => {
  const target = useTarget();

  it("the combo tool reports the combo.json the bundle was built with", async () => {
    const t = target();
    const client = new RawClient({
      url: t.mcpUrl,
      clientName: "ev-e2e-sep",
      protocolVersion: "2025-06-18",
    });
    await client.initialize();
    const res = await client.request("tools/call", {
      name: "combo",
      arguments: {},
    });
    const reported = JSON.parse(toolText(res.body.result));
    expect(reported.combo.sha).toBe(t.combo.sha);
    expect(reported.combo.sdk.server).toBe(t.combo.sdk.server);
    expect(reported.combo.mcpUse.tarballSha256).toEqual(
      t.combo.mcpUse.tarballSha256
    );
    expect(reported.instance).toMatch(/^.+:[0-9a-f-]{36}$/);
  });

  it("the startup record with the instance id is in the runtime logs", async () => {
    const lines = await target().logs();
    const startup = lines.map(tryJson).find((l) => l?.msg === "startup");
    expect(startup?.combo).toBe(target().combo.sha);
  });

  // TODO(events): health route assertions (binding, layout 1, nsHash and R3b
  // build.sha / sdk.bundled / sdk.bundledHash / sdk.external / sdk.patchedPredicate
  // via compareIdentity in scripts/lib.mjs) once WP-26 ships the health route.
});

function tryJson(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
