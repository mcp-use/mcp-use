import type { ProviderName } from "@/llm/types";
import { cn } from "@/client/lib/utils";
import { useTheme } from "@/client/context/ThemeContext";

// OpenRouter doesn't ship a logo on our provider CDN yet, so inline the
// official mark as a data URL with a neutral gray fill.
const OPENROUTER_ICON_SVG = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill="#94A3B8" stroke="#94A3B8"><g><path fill="none" d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945" stroke-width="90"/><path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z"/><path fill="none" d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377" stroke-width="90"/><path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z"/></g></svg>`;
const OPENROUTER_ICON_URL = `data:image/svg+xml,${encodeURIComponent(OPENROUTER_ICON_SVG)}`;

export function getProviderLabel(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "openai-compatible":
      return "OpenAI Compatible";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    default:
      return provider;
  }
}

function getProviderIconSrc(
  provider: ProviderName,
  resolvedTheme: "light" | "dark"
): string | null {
  switch (provider) {
    case "openai":
    case "anthropic":
    case "google":
      return `https://inspector-cdn.mcp-use.com/providers/${provider}.png`;
    case "ollama": {
      // Ollama ships separate light/dark marks so the logo stays legible
      // against the surrounding chrome in either theme.
      const variant = resolvedTheme === "dark" ? "ollama_dark" : "ollama_light";
      return `https://inspector-cdn.mcp-use.com/providers/${variant}.png`;
    }
    case "openrouter":
      return OPENROUTER_ICON_URL;
    case "openai-compatible":
      return null;
    default:
      return null;
  }
}

export function ProviderIcon({
  provider,
  className,
}: {
  provider: ProviderName;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();

  if (provider === "openai-compatible") {
    return null;
  }

  const iconSrc = getProviderIconSrc(provider, resolvedTheme);

  if (iconSrc) {
    // Ollama's mark has its own padding and isn't circular, so render it a
    // touch smaller and skip the rounded-full crop that suits the other marks.
    const imgClasses =
      provider === "ollama"
        ? "h-3.5 w-3.5 object-contain"
        : "h-4 w-4 rounded-full object-cover";
    return (
      <img
        src={iconSrc}
        alt={getProviderLabel(provider)}
        className={cn(imgClasses, className)}
      />
    );
  }

  return (
    <div
      aria-label={getProviderLabel(provider)}
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-[9px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900",
        className
      )}
    >
      {getProviderLabel(provider).charAt(0)}
    </div>
  );
}
