import { describe, expect, it } from "vitest";
import { shouldShowFreeTierUpgrade } from "../freeTier";

describe("shouldShowFreeTierUpgrade", () => {
  it("shows the sign-in CTA for anonymous managed visitors (hosted inspector)", () => {
    expect(
      shouldShowFreeTierUpgrade({
        isManaged: true,
        enableFreeTierUpgrade: true,
        isAuthenticated: false,
      })
    ).toBe(true);
  });

  it("hides the sign-in CTA once the visitor is signed in (MCP-2142)", () => {
    expect(
      shouldShowFreeTierUpgrade({
        isManaged: true,
        enableFreeTierUpgrade: true,
        isAuthenticated: true,
      })
    ).toBe(false);
  });

  it("never shows when the host did not opt into the free-tier UI (embeds)", () => {
    expect(
      shouldShowFreeTierUpgrade({
        isManaged: true,
        enableFreeTierUpgrade: false,
        isAuthenticated: false,
      })
    ).toBe(false);
  });

  it("never shows for BYOK / client-side LLM (not managed)", () => {
    expect(
      shouldShowFreeTierUpgrade({
        isManaged: false,
        enableFreeTierUpgrade: true,
        isAuthenticated: false,
      })
    ).toBe(false);
  });
});
