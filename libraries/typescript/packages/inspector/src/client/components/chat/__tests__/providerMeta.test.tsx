import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModelConfigBadge } from "../providerMeta";

vi.mock("@/client/context/ThemeContext", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

describe("ModelConfigBadge", () => {
  it.each([
    ["anthropic", "Claude Sonnet", "Anthropic"],
    ["google", "Gemini Flash", "Google"],
    ["openai", "GPT", "OpenAI"],
  ])(
    "uses the selected %s model instead of the default transport model",
    (provider, name, label) => {
      const html = renderToStaticMarkup(
        <ModelConfigBadge
          mode="managed"
          provider="openai-compatible"
          model="openai/default-model"
          managedModel={{
            id: `${provider}/selected-model`,
            name: `${label}: ${name}`,
            provider,
          }}
        />
      );
      expect(html).toContain(`alt="${label}"`);
      expect(html).toContain(`/providers/${provider}.png`);
      expect(html).toContain(`>${name}</span>`);
      expect(html).toContain('alt="Manufact"');
      if (provider !== "openai") expect(html).not.toContain('alt="OpenAI"');
    }
  );

  it("falls back to the configured model before the catalog loads", () => {
    const html = renderToStaticMarkup(
      <ModelConfigBadge
        mode="managed"
        provider="openai-compatible"
        model="google/gemini"
      />
    );
    expect(html).toContain('alt="Google"');
    expect(html).toContain(">google/gemini</span>");
  });

  it("keeps BYOK branding independent of the managed selection", () => {
    const html = renderToStaticMarkup(
      <ModelConfigBadge
        provider="anthropic"
        model="claude"
        managedModel={{
          id: "google/gemini",
          name: "Gemini",
          provider: "google",
        }}
      />
    );
    expect(html).toContain('alt="Anthropic"');
    expect(html).toContain(">claude</span>");
    expect(html).not.toContain('alt="Manufact"');
  });
});
