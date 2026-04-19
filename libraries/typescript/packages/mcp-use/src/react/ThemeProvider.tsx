import React, { useEffect, useLayoutEffect, useState } from "react";
import { useWidget } from "./useWidget.js";

/**
 * ThemeProvider that manages dark mode class on document root
 *
 * Priority:
 * 1. useWidget theme (from OpenAI Apps SDK)
 * 2. System preference (prefers-color-scheme: dark)
 *
 * Sets the "dark" class and data-theme attribute on document.documentElement.
 * color-scheme is only set when the colorScheme prop is true — setting it to an
 * explicit value causes browsers to paint an opaque canvas behind iframes when
 * the widget and host documents use different schemes.
 */
export const ThemeProvider: React.FC<{
  children: React.ReactNode;
  colorScheme?: boolean;
}> = ({ children, colorScheme = false }) => {
  const { theme, isAvailable } = useWidget();
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

  // Calculate effective theme
  const effectiveTheme = isAvailable ? theme : systemPreference;

  // Apply theme synchronously before browser paint to prevent flash
  // Sets CSS class (for Tailwind dark mode) and data-theme attribute
  // (for OpenAI Apps SDK UI design tokens).
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;

    // Apply or remove dark class (Tailwind dark mode)
    root.classList.remove("light", "dark");
    root.classList.add(effectiveTheme === "dark" ? "dark" : "light");

    // Set data-theme attribute (OpenAI Apps SDK UI design tokens)
    root.setAttribute(
      "data-theme",
      effectiveTheme === "dark" ? "dark" : "light"
    );

    // Only set color-scheme when explicitly opted in via the colorScheme prop.
    // Setting it to "dark"/"light" triggers browsers to paint an opaque canvas
    // behind iframes when the widget scheme differs from the host scheme, which
    // makes background-color: transparent ineffective.
    if (colorScheme) {
      root.style.colorScheme = effectiveTheme === "dark" ? "dark" : "light";
    } else {
      root.style.colorScheme = "";
    }
  }, [effectiveTheme, colorScheme]);

  return <>{children}</>;
};
