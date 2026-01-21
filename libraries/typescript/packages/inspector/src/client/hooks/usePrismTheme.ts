import { useTheme } from "@/client/context/ThemeContext";
import { githubGist } from "react-syntax-highlighter/dist/cjs/styles/hljs";

// Custom "GitHub Gist (dark)" hljs theme.
// We base it on the stock githubGist theme but swap to GitHub-dark-ish colors and
// keep backgrounds transparent so the surrounding panel controls the surface color.
const githubGistDark: Record<string, any> = {
  ...githubGist,
  hljs: {
    ...(githubGist as any).hljs,
    background: "transparent",
    color: "#c9d1d9",
  },
  "hljs-comment": { color: "#8b949e" },
  "hljs-meta": { color: "#8b949e" },
  "hljs-variable": { color: "#ffa657" },
  "hljs-template-variable": { color: "#ffa657" },
  "hljs-strong": { color: "#ffa657" },
  "hljs-emphasis": { color: "#ffa657" },
  "hljs-quote": { color: "#ffa657" },
  "hljs-keyword": { color: "#ff7b72" },
  "hljs-selector-tag": { color: "#ff7b72" },
  "hljs-type": { color: "#ff7b72" },
  "hljs-literal": { color: "#79c0ff" },
  "hljs-symbol": { color: "#79c0ff" },
  "hljs-bullet": { color: "#79c0ff" },
  "hljs-attribute": { color: "#79c0ff" },
  "hljs-section": { color: "#7ee787" },
  "hljs-name": { color: "#7ee787" },
  "hljs-tag": { color: "#c9d1d9" },
  "hljs-title": { color: "#d2a8ff" },
  "hljs-attr": { color: "#d2a8ff" },
  "hljs-selector-id": { color: "#d2a8ff" },
  "hljs-selector-class": { color: "#d2a8ff" },
  "hljs-selector-attr": { color: "#d2a8ff" },
  "hljs-selector-pseudo": { color: "#d2a8ff" },
  "hljs-addition": {
    color: "#3fb950",
    backgroundColor: "rgba(46, 160, 67, 0.15)",
  },
  "hljs-deletion": {
    color: "#f85149",
    backgroundColor: "rgba(248, 81, 73, 0.15)",
  },
  "hljs-link": { textDecoration: "underline" },
  "hljs-number": { color: "#79c0ff" },
  "hljs-string": { color: "#a5d6ff" },
};

export function usePrismTheme(): {
  prismStyle: Record<string, any>;
  isDark: boolean;
} {
  const { resolvedTheme } = useTheme();

  const getPrismStyle = () => {
    const baseStyle = resolvedTheme === "dark" ? githubGistDark : githubGist;

    return {
      ...baseStyle,
      'pre[class*="language-"]': {
        ...baseStyle['pre[class*="language-"]'],
        backgroundColor: "transparent",
      },
      'code[class*="language-"]': {
        ...baseStyle['code[class*="language-"]'],
        backgroundColor: "transparent",
      },
    };
  };

  return {
    prismStyle: getPrismStyle(),
    isDark: resolvedTheme === "dark",
  };
}
