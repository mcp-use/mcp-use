import { describe, expect, it } from "vitest";
import {
  isCloudFetchFailure,
  isManagedLlmConfig,
  managedNoticeFromHttpResponse,
  managedNoticeFromLlmError,
} from "../managedChatNotice";

describe("managedChatNotice", () => {
  it("detects managed LLM configs", () => {
    expect(
      isManagedLlmConfig({
        provider: "openai-compatible",
        model: "test",
        apiKey: "server-managed",
        baseUrl: "https://cloud.manufact.com/api/v1/inspector/llm",
      })
    ).toBe(true);
    expect(
      isManagedLlmConfig({
        provider: "openai",
        model: "gpt-5",
        apiKey: "sk-test",
      })
    ).toBe(false);
  });

  it("maps fetch failures to cloud unavailable", () => {
    expect(managedNoticeFromLlmError(new TypeError("Failed to fetch"))).toEqual(
      {
        kind: "cloud_unavailable",
      }
    );
    expect(isCloudFetchFailure(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("maps login-required 429 responses", () => {
    const error = Object.assign(new Error("rate limited"), {
      name: "LlmRequestError",
      status: 429,
      body: {
        loginRequired: true,
        loginUrl: "https://manufact.com/login",
      },
    });
    expect(managedNoticeFromLlmError(error)).toEqual({
      kind: "login_required",
      loginUrl: "https://manufact.com/login",
    });
  });

  it("maps login-required 429 from wrapped OpenAI error messages", () => {
    expect(
      managedNoticeFromLlmError(
        new Error(
          'OpenAI request failed (429 Too Many Requests): {"error":"rate_limited","loginRequired":true,"loginUrl":"https://manufact.com/login"}'
        )
      )
    ).toEqual({
      kind: "login_required",
      loginUrl: "https://manufact.com/login",
    });
  });

  it("maps credits exhausted responses", () => {
    expect(
      managedNoticeFromHttpResponse(402, {
        message: "Out of credits",
        upgradeUrl: "https://manufact.com/cloud",
      })
    ).toEqual({
      kind: "credits_exhausted",
      billingUrl: "https://manufact.com/cloud",
      message: "Out of credits",
    });

    expect(
      managedNoticeFromHttpResponse(429, {
        creditsExhausted: true,
        billingUrl: "https://manufact.com/cloud/billing",
      })
    ).toEqual({
      kind: "credits_exhausted",
      billingUrl: "https://manufact.com/cloud/billing",
      message: "You've used your included free plan credits.",
    });
  });

  it("maps upstream 502 responses to cloud unavailable", () => {
    expect(
      managedNoticeFromHttpResponse(502, { error: "bad gateway" })
    ).toEqual({ kind: "cloud_unavailable" });
  });
});
