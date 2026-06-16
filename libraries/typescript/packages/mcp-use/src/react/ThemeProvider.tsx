import React, { useEffect, useLayoutEffect, useState } from "react";
import { applyHostStyleVariables } from "./host-styles.js";
import { useWidget } from "./useWidget.js";

/**
 * ThemeProvider that manages dark mode class on document root
 *
 * Priority:
 * 1. Explicit host context theme
 * 2. System preference (prefers-color-scheme: dark)
 *
 * Sets the "dark" class and data-theme attribute on document.documentElement.
 * color-scheme is set by default so host variables using CSS light-dark()
 * resolve against the active host theme.
 */
export const ThemeProvider: React.FC<{
  children: React.ReactNode;
  colorScheme?: boolean;
}> = ({ children, colorScheme = true }) => {
  const { hostContext } = useWidget();
  const [systemPreference, setSystemPreference] = useState<"light" | "dark">(
    () => {
      if (typeof window === "undefined") return "light";
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
  );

  // Listen to system preference changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: { matches: boolean }) => {
      setSystemPreference(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Calculate effective theme. useWidget() normalizes a missing host theme to
  // "light" for consumers, so ThemeProvider reads the raw host context to avoid
  // treating an omitted host value as an explicit light-mode preference.
  const hostTheme =
    hostContext?.theme === "dark" || hostContext?.theme === "light"
      ? hostContext.theme
      : undefined;
  const effectiveTheme = hostTheme ?? systemPreference;

  // Apply theme synchronously before browser paint to prevent flash
  // Sets CSS class (for Tailwind dark mode) and data-theme attribute
  // (for UI design tokens).
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;

    // Apply or remove dark class (Tailwind dark mode)
    root.classList.remove("light", "dark");
    root.classList.add(effectiveTheme === "dark" ? "dark" : "light");

    // Set data-theme attribute (UI design tokens)
    root.setAttribute(
      "data-theme",
      effectiveTheme === "dark" ? "dark" : "light"
    );

    if (colorScheme) {
      root.style.colorScheme = effectiveTheme === "dark" ? "dark" : "light";
    } else {
      root.style.colorScheme = "";
    }
  }, [effectiveTheme, colorScheme]);

  useLayoutEffect(() => {
    applyHostStyleVariables(hostContext?.styles?.variables);
  }, [hostContext]);

  return <>{children}</>;
};
