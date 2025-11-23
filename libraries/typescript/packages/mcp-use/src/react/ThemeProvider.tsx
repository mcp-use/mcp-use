import React, { useEffect, useState } from "react";
import { useWidget } from "./useWidget.js";

/**
 * ThemeProvider that manages dark mode class on document root
 *
 * Priority:
 * 1. useWidget theme (from OpenAI Apps SDK)
 * 2. System preference (prefers-color-scheme: dark)
 *
 * Sets the "dark" class on document.documentElement when dark mode is active
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { theme, isAvailable } = useWidget();
  console.log("theme", theme);
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

  // Apply dark class based on priority: widget theme > system preference
  useEffect(() => {
    if (typeof document === "undefined") return;

    // Priority 1: If widget API is available, use widget theme
    const effectiveTheme = isAvailable ? theme : systemPreference;

    // Apply or remove dark class
    if (effectiveTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme, isAvailable, systemPreference]);

  return <>{children}</>;
};

