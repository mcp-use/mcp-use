import { describe, it, expect } from "vitest";
import {
  DEFAULT_OLLAMA_BASE_URL,
  buildOllamaApiUrl,
  normalizeOllamaBaseUrl,
} from "@/llm/providers/ollama/utils";

describe("normalizeOllamaBaseUrl", () => {
  it("returns the default when no base url is supplied", () => {
    expect(normalizeOllamaBaseUrl()).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(normalizeOllamaBaseUrl("")).toBe(DEFAULT_OLLAMA_BASE_URL);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeOllamaBaseUrl("  http://example.com  ")).toBe(
      "http://example.com"
    );
  });

  it("strips trailing slashes", () => {
    expect(normalizeOllamaBaseUrl("http://example.com/")).toBe(
      "http://example.com"
    );
    expect(normalizeOllamaBaseUrl("http://example.com///")).toBe(
      "http://example.com"
    );
  });

  it("strips a trailing /api segment", () => {
    expect(normalizeOllamaBaseUrl("http://example.com/api")).toBe(
      "http://example.com"
    );
    expect(normalizeOllamaBaseUrl("http://example.com/api/")).toBe(
      "http://example.com"
    );
  });

  it("handles pathological inputs in linear time", () => {
    const start = Date.now();
    const input = "http://example.com" + "/".repeat(100_000);
    expect(normalizeOllamaBaseUrl(input)).toBe("http://example.com");
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("buildOllamaApiUrl", () => {
  it("joins the normalized base url with an /api path", () => {
    expect(buildOllamaApiUrl("http://example.com/", "/api/chat")).toBe(
      "http://example.com/api/chat"
    );
    expect(buildOllamaApiUrl("http://example.com/api", "/api/tags")).toBe(
      "http://example.com/api/tags"
    );
    expect(buildOllamaApiUrl(undefined, "/api/chat")).toBe(
      `${DEFAULT_OLLAMA_BASE_URL}/api/chat`
    );
  });
});
