import { describe, expect, it } from "vitest";
import {
  buildScarfBeaconUrl,
  SCARF_GATEWAY_BEACON_URL,
} from "../../../src/telemetry/tel-fetch.js";

describe("buildScarfBeaconUrl", () => {
  it("encodes properties as query params", () => {
    const url = buildScarfBeaconUrl({
      event: "package_download",
      package: "inspector",
      first_download: true,
    });
    expect(url.startsWith(SCARF_GATEWAY_BEACON_URL)).toBe(true);
    expect(url).toContain("event=package_download");
    expect(url).toContain("package=inspector");
    expect(url).toContain("first_download=true");
  });

  it("truncates large query/response fields", () => {
    const url = buildScarfBeaconUrl({
      event: "mcp_agent_execution",
      query: "x".repeat(200),
    });
    expect(url.length).toBeLessThanOrEqual(1800);
    expect(url).toContain("query=");
    expect(url).not.toContain("x".repeat(200));
  });
});
