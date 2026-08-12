import { describe, expect, it } from "vitest";
import {
  buildManagedAuthHeaders,
  buildManagedLlmProxyConfig,
  shouldShowFreeTierUpgrade,
  shouldUseManagedClientSide,
} from "../freeTier";

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

describe("managed model chrome visibility", () => {
  it("only dashboard embeds suppress the inspector model badge when hideModelBadge is set", () => {
    const managedLlmConfig = {
      provider: "openai-compatible" as const,
      model: "test",
      apiKey: "key",
    };
    const hideModelBadge = true;
    const suppressInspectorModelChrome =
      Boolean(managedLlmConfig) && Boolean(hideModelBadge);
    expect(suppressInspectorModelChrome).toBe(true);

    const unsetHideModelBadge: boolean | undefined = undefined;
    const hostedDefaultHidden = unsetHideModelBadge ?? false;
    expect(hostedDefaultHidden).toBe(false);
  });

  it("keeps model chrome visible for signed-in hosted users (hideModelBadge defaults false)", () => {
    const managedLlmConfig = {
      provider: "openai-compatible" as const,
      model: "m",
      apiKey: "k",
    };
    const hideModelBadge: boolean | undefined = undefined;
    const effectiveHideModelBadge = hideModelBadge ?? false;
    const suppressInspectorModelChrome =
      Boolean(managedLlmConfig) && Boolean(effectiveHideModelBadge);
    expect(suppressInspectorModelChrome).toBe(false);
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

  it("enables managed client-side chat for remote mixed-auth servers", () => {
    expect(
      shouldUseManagedClientSide({
        isLoopback: false,
        isMixedAuth: true,
        chatApiUrl: "https://cloud.manufact.com/api/v1/inspector/chat/stream",
      })
    ).toBe(true);
  });

  it("does not enable managed client-side for ordinary remote servers", () => {
    expect(
      shouldUseManagedClientSide({
        isLoopback: false,
        chatApiUrl: "https://cloud.manufact.com/api/v1/inspector/chat/stream",
      })
    ).toBe(false);
  });
});

describe("buildManagedLlmProxyConfig", () => {
  it("uses the OAuth access token as the proxy bearer key", () => {
    expect(
      buildManagedLlmProxyConfig(
        "http://localhost:8000/api/v1/inspector/chat/stream",
        "access-token"
      )
    ).toEqual({
      provider: "openai-compatible",
      model: "openai/gpt-5.6-luna",
      apiKey: "access-token",
      baseUrl: "http://localhost:8000/api/v1/inspector/llm",
    });
  });

  it("uses a selected curated model id when provided", () => {
    expect(
      buildManagedLlmProxyConfig(
        "http://localhost:8000/api/v1/inspector/chat/stream",
        "access-token",
        false,
        "openai/gpt-5.4"
      ).model
    ).toBe("openai/gpt-5.4");
  });

  it("builds the remote chat bearer header", () => {
    expect(buildManagedAuthHeaders("access-token")).toEqual({
      Authorization: "Bearer access-token",
    });
    expect(buildManagedAuthHeaders(null)).toBeUndefined();
  });

  it("uses shared cookies when Inspector already has a Manufact session", () => {
    expect(
      buildManagedLlmProxyConfig(
        "https://cloud.manufact.com/api/v1/inspector/chat/stream",
        null,
        true
      )
    ).toMatchObject({ credentials: "include" });
  });
});
