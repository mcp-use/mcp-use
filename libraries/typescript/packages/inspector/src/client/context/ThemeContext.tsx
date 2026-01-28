"use client";

import type { ReactNode } from "react";
import { createContext, use, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = use(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  forcedTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  forcedTheme,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(forcedTheme || defaultTheme);
  const [mounted, setMounted] = useState(false);

  // Get system theme preference
  const getSystemTheme = (): "light" | "dark" => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };

  // Get resolved theme (actual theme being used)
  const resolvedTheme = theme === "system" ? getSystemTheme() : theme;

  // Apply theme to document
  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement;
    const actualTheme = newTheme === "system" ? getSystemTheme() : newTheme;

    root.classList.remove("light", "dark");
    root.classList.add(actualTheme);

    // Store theme preference only if not forced
    if (!forcedTheme) {
      localStorage.setItem(storageKey, newTheme);
    }
  };

  // Initialize theme on mount
  useEffect(() => {
    setMounted(true);

    // Use forced theme if provided, otherwise get stored theme or use default
    const storedTheme = localStorage.getItem(storageKey) as Theme;
    const initialTheme = forcedTheme || storedTheme || defaultTheme;

    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, [defaultTheme, storageKey, forcedTheme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      applyTheme("system");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  // Update theme when it changes
  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
  }, [theme, mounted]);

  const handleSetTheme = (newTheme: Theme) => {
    // Prevent theme changes when forced theme is set
    if (forcedTheme) {
      console.warn(
        "[ThemeProvider] Theme is forced via URL parameter, ignoring setTheme call"
      );
      return;
    }
    setTheme(newTheme);
  };

  return (
    <ThemeContext value={{ theme, setTheme: handleSetTheme, resolvedTheme }}>
      {children}
    </ThemeContext>
  );
}
