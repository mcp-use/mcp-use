import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import React, { useLayoutEffect, useState } from "react";

import { useHostContextSubscription } from "../runtime/view-runtime-context.js";

/**
 * Applies host theme, style variables, and fonts to the document root.
 */
export const ThemeProvider: React.FC<{
  children: React.ReactNode;
  /** Set `color-scheme` on the document root to match the active theme. */
  colorScheme?: boolean;
}> = ({ children, colorScheme = true }) => {
  const hostContext = useHostContextSubscription();
  const [systemPreference, setSystemPreference] = useState<"light" | "dark">(
    () => {
      if (typeof window === "undefined") return "light";
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPreference(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const hostTheme =
    hostContext?.theme === "dark" || hostContext?.theme === "light"
      ? hostContext.theme
      : undefined;
  const effectiveTheme = hostTheme ?? systemPreference;

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    applyDocumentTheme(effectiveTheme);
    if (colorScheme) {
      document.documentElement.style.colorScheme =
        effectiveTheme === "dark" ? "dark" : "light";
    } else {
      document.documentElement.style.colorScheme = "";
    }
  }, [effectiveTheme, colorScheme]);

  useLayoutEffect(() => {
    const variables = hostContext?.styles?.variables;
    if (variables) {
      applyHostStyleVariables(variables);
    }
    const fonts = hostContext?.styles?.css?.fonts;
    if (typeof fonts === "string") {
      applyHostFonts(fonts);
    }
  }, [hostContext]);

  return <>{children}</>;
};
