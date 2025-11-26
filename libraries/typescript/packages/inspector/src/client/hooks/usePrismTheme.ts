import {
  vs,
  vscDarkPlus,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/client/context/ThemeContext";

export function usePrismTheme(): {
  prismStyle: Record<string, any>;
  isDark: boolean;
} {
  const { resolvedTheme } = useTheme();

  const getPrismStyle = () => {
    const baseStyle = resolvedTheme === "dark" ? vscDarkPlus : vs;

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
