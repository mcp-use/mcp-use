import { describe, expect, it } from "vitest";
import { shouldShowFreeTierUpgrade, shouldUseManagedClientSide, buildManagedLlmProxyConfig } from "../freeTier";

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

describe("shouldUseManagedClientSide", () => {
  it("enables managed client-side chat for loopback servers with chatApiUrl", () => {
    expect(
      shouldUseManagedClientSide({
        isLoopback: true,
        chatApiUrl: "https://cloud.manufact.com/api/v1/inspector/chat/stream",
      })
    ).toBe(true);
  });

  it("does not enable managed client-side for remote servers", () => {
    expect(
      shouldUseManagedClientSide({
        isLoopback: false,
        chatApiUrl: "https://cloud.manufact.com/api/v1/inspector/chat/stream",
      })
    ).toBe(false);
  });
});

describe("buildManagedLlmProxyConfig", () => {
  it("builds an openai-compatible proxy config with session cookies", () => {
    expect(
      buildManagedLlmProxyConfig(
        "http://localhost:8000/api/v1/inspector/chat/stream"
      )
    ).toEqual({
      provider: "openai-compatible",
      model: "anthropic/claude-haiku-4.5",
      apiKey: "server-managed",
      baseUrl: "http://localhost:8000/api/v1/inspector/llm",
      credentials: "include",
    });
  });
});
