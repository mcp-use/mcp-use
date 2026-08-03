import { describe, expect, it } from "vitest";
import { formatMcpNotReadyReason } from "../../../src/react/useMcp-helpers.js";

describe("formatMcpNotReadyReason", () => {
  it("reports disconnected client when ref is null but state is ready", () => {
    expect(formatMcpNotReadyReason("ready", false)).toBe(
      "client disconnected (state=ready)"
    );
  });

  it("reports state when client exists but state is not ready", () => {
    expect(formatMcpNotReadyReason("discovering", true)).toBe(
      "state=discovering"
    );
  });
});
