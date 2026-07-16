import langBash from "@shikijs/langs/bash";
import langJavascript from "@shikijs/langs/javascript";
import langJson from "@shikijs/langs/json";
import langPython from "@shikijs/langs/python";
import langTypescript from "@shikijs/langs/typescript";
import themeGithubDark from "@shikijs/themes/github-dark";
import themeGithubLight from "@shikijs/themes/github-light";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type {
  BundledLanguage,
  BundledTheme,
  ThemeRegistrationAny,
  TokensResult,
} from "shiki";
import type { CodeHighlighterPlugin } from "streamdown";

type ThemeInput = BundledTheme | ThemeRegistrationAny;

const SLIM_LANGS = [
  "javascript",
  "js",
  "typescript",
  "ts",
  "python",
  "py",
  "bash",
  "sh",
  "shell",
  "json",
] as const;

type SlimLang = (typeof SLIM_LANGS)[number];

const LANG_SET = new Set<string>(SLIM_LANGS);

const CANONICAL_LANG: Record<string, SlimLang> = {
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  python: "python",
  py: "python",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  json: "json",
};

function resolveLang(language: string): SlimLang | null {
  const key = language.trim().toLowerCase();
  return LANG_SET.has(key) ? (CANONICAL_LANG[key] ?? null) : null;
}

function themeName(theme: ThemeInput): string {
  return typeof theme === "string" ? theme : (theme.name ?? "custom");
}

let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [themeGithubLight, themeGithubDark],
      langs: [langJavascript, langTypescript, langPython, langBash, langJson],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return highlighterPromise;
}

const resultCache = new Map<string, TokensResult>();
const pendingCallbacks = new Map<string, Set<(result: TokensResult) => void>>();

function cacheKey(
  code: string,
  language: string,
  themes: [string, string]
): string {
  const head = code.slice(0, 100);
  const tail = code.length > 100 ? code.slice(-100) : "";
  return `${language}:${themes[0]}:${themes[1]}:${code.length}:${head}:${tail}`;
}

/** Shiki plugin for Streamdown — typescript, js, python, bash, json only. */
export const slimCode: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  getSupportedLanguages: () => [...SLIM_LANGS] as BundledLanguage[],
  getThemes: () => ["github-light", "github-dark"],
  supportsLanguage: (language) => resolveLang(String(language)) != null,
  highlight({ code, language, themes }, callback) {
    const resolved = resolveLang(String(language));
    if (!resolved) return null;

    const light = themeName(themes[0]);
    const dark = themeName(themes[1]);
    const key = cacheKey(code, resolved, [light, dark]);

    const cached = resultCache.get(key);
    if (cached) return cached;

    if (callback) {
      if (!pendingCallbacks.has(key)) pendingCallbacks.set(key, new Set());
      pendingCallbacks.get(key)!.add(callback);
    }

    getHighlighter()
      .then(
        (highlighter: Awaited<ReturnType<typeof createHighlighterCore>>) => {
          const result = highlighter.codeToTokens(code, {
            lang: resolved,
            themes: { light, dark },
          });
          resultCache.set(key, result);
          const waiters = pendingCallbacks.get(key);
          if (waiters) {
            for (const cb of waiters) cb(result);
            pendingCallbacks.delete(key);
          }
        }
      )
      .catch((error: unknown) => {
        console.error("[Streamdown Code] Failed to highlight code:", error);
        pendingCallbacks.delete(key);
      });

    return null;
  },
};
